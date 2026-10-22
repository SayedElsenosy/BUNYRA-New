# Tenant isolation (Request 2)

## How a request is isolated

1. `identity()` (lib/bunyra/http.ts) returns a Neon client wrapped by `tenantSql()` (lib/bunyra/tenant.ts).
2. Every company-scoped service starts with `access()` (lib/bunyra/service.ts). It checks the active membership,
   company status and permission (or the platform owner, with an audit entry), then calls `bindTenant()`.
3. After binding, every query of that request is sent as one Neon HTTP transaction prefixed by
   `SET LOCAL ROLE bunyra_tenant` and `set_config('app.company_id' / 'app.user_id')`.
4. `bunyra_tenant` has `NOBYPASSRLS`. Every table with `company_id` (and `companies`, `audit_logs`) has forced RLS with
   policy `company_id = (SELECT bunyra_tenant_company())`. The function returns the requested company only when the
   user is an active member of an active company, or is the platform owner. Otherwise no row is visible or writable.

So a query that forgets `WHERE company_id = ...`, a forged company id, or an id belonging to another company cannot
read or change another company's rows. Unbound queries (session lookup, invitation acceptance, platform console)
keep the server role and stay explicitly filtered in code.

## Database rules (db/009-tenant-isolation.sql)

- Tenant role: `SELECT/INSERT/UPDATE` on tenant tables, `DELETE` only on `plan_unit_shapes`, `SELECT/INSERT` on
  `audit_logs`, and on `companies` only the profile columns (not `status`). No access to `platform_owner` or
  `schema_migrations`.
- `audit_logs` is append-only for every role (UPDATE/DELETE/TRUNCATE raise `AUDIT_IMMUTABLE`).

## Tests

`npm run test:tenancy` (scripts/test-tenancy.mjs) checks cross-company reads/writes, forged contexts, inactive members,
suspended companies, owner scope, append-only audit, and that every table with `company_id` has forced RLS and a tenant
policy (new tables without RLS fail this test). Existing suites now call services through `tenantSql()` like the API.
Run against a dedicated test database only (`BUNYRA_TEST_DATABASE_URL`, `BUNYRA_ALLOW_TEST_FIXTURES=1`).

## Foundation batch A: HTTP client guard (2026-10-22)

The request-scoped `tenantSql()` now explicitly rejects `unsafe()` calls instead of delegating them to the raw Neon client. Raw calls otherwise skip the wrapper's local tenant role and identity context. Normal tagged queries, parameterized text queries, and transactions are unchanged.

`npm run test:tenant-client` provides database-free coverage in GitHub CI. It does not replace dedicated Neon branch integration tests or penetration testing.
