# Phase 1 — Import Real-Estate-Workspace operational backend into BUNYRA-New

## Already present in BUNYRA-New
- `projects(company_id,id)` is the project source of truth from `001-foundation.sql`. Recreating it would conflict and invalidate dozens of existing FKs.
- `inventory_units(company_id,project_id,id)` is the unit source of truth; status/price/approved pricing and existing `bookings` depend on it.
- `bookings` already supports sales request -> operations approval -> accounts acknowledgement, with pricing version snapshots, partial unique active unit reservation and approved price book constraints.
- `audit_logs` already exists under the BUNYRA-specific schema.
- PostgreSQL role `bunyra_tenant` and `bunyra_tenant_company()` authorize membership and active company, not a legacy session-supplied tenant UUID.

## New additive migration
`db/067-workspace-inventory-hierarchy.sql`
- Adds `phases(company_id,project_id,...)`.
- Adds `buildings(company_id,project_id,phase_id,...)`.
- Adds `units(company_id,project_id,id,building_id,svg_coordinates)` as a **one-to-one extension** keyed by existing `inventory_units.id`. No new price or booking status is stored in `units` and historical units can exist without extension rows.
- Existing `projects` is reused without changes.
- New tables have composite FKs for project, phase, building and inventory unit, ensuring every ancestor is within the same company and project.
- All new tables have RLS ENABLE + FORCE; SELECT/INSERT/UPDATE on the `bunyra_tenant` role are conditional on `company_id=(SELECT bunyra_tenant_company())`.
- No DELETE/TRUNCATE grants added. No existing data updated or duplicated.
- The migration is not auto-applied by import; `npm run db:migrate` applies it later in numeric order.

## Tenant propagation / authentication
`lib/bunyra/create-confirmed-booking.ts` (new backend-only service):
1. Calls `identity()` -> `getCurrentUser()`, which verifies BUNYRA managed-account session or supported Neon Auth bridge. No NextAuth dependency, no company/tenant/user ID accepted in input.
2. Resolves `companyId` with `memberships` + `companies` + `projects` using the authenticated `actor.userId` and active membership.
3. Calls `access()` for BOTH `bookings.create` and `bookings.approve`, project-scoped. Direct approval is restricted to a `company_admin` (ordinary sales users retain the existing approval workflow).
4. `access()` binds the tenant to a `tenantSql` client. Its `sql.transaction([...])` prefixes `SET LOCAL ROLE bunyra_tenant` and `set_config('app.company_id', verifiedCompanyId, true)`, `set_config('app.user_id', actor.userId, true)`.
5. Uses `SELECT ... FOR UPDATE` on the canonical `inventory_units`, validates approved price book/version and active-booking conflicts, and commits the booking ('approved'), unit transition ('reserved'), status history and audit as one transaction. Unique active unit index also prevents concurrent double booking.
6. The new service isn't wired to a public API in this phase. Existing `POST /api/commercial` flow is untouched; there is no UI transfer.

## Testing and rollout boundaries
- `scripts/test-workspace-inventory-merge.mjs` checks migration constraints, project isolation, source-of-truth reuse, identity source, lock and transaction wiring.
- Run `npm run typecheck`, Cloudflare build, and existing integration tests before activating any new API.
- A Neon migration rehearsal needs a disposable branch. At time of writing Neon refused a new branch for the BUNYRA New project with **branches limit exceeded**. The existing production and shared development branches were deliberately left unchanged.
- Before production apply, free a branch slot manually or provision a test project, apply `067`, and test cross-tenant insert and concurrent booking there.
- This phase contains **backend only**. No FloorplanViewer, inventory-client or UI pages were copied.
