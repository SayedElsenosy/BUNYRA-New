# Company lifecycle (Request 4)

Migration: `db/010-company-lifecycle.sql`. Service: `lib/bunyra/companies.ts`. Tests: `npm run test:companies`.

## Creating a company and its owner account
`POST /api/platform` (platform owner only) creates the company, its `company_settings` row and, when
`owner_email` is given, a `company_admin` invitation in one transaction. The response contains the
one-time invitation token; the console shows the link `/join#token=…`. The owner signs in with Neon Auth
using that email and accepting the invitation creates the `company_admin` membership. Accounts are never
created with passwords by the platform; the invitation binds the account to the email.

## Registration requests
- `POST /api/company-requests` is public (same-origin, honeypot field `website`, one pending request per
  email, global cap of 50 requests per hour). Public page: `/register`.
- `GET`/`PATCH /api/company-requests` are platform-owner only. Approving creates the company, settings and
  the owner invitation exactly once (row lock + optimistic `version`); rejecting stores the note.
- `company_requests` has forced RLS and no grants to `bunyra_tenant`.

## Safe deletion
1. **Impact**: `GET /api/platform/lifecycle?company=<id>` returns record counts per area.
2. **Delete** (`POST … {operation:'delete', id, version, confirm:<exact company name>}`): sets status
   `deleted`, revokes pending invitations, and starts a 30-day retention period (`purge_after`). Members and
   the owner workspace lose access at the database level (`bunyra_tenant_company()` returns no company).
3. **Restore** (`operation:'restore'`) during retention returns the previous status with all data.
4. **Purge** (`operation:'purge'`, name confirmation, only after `purge_after`): deletes all company
   business data child-first in one transaction, removes plan files from object storage, and clears contact
   details. The `companies` row (name, dates) and `audit_logs` are kept for legal retention; audit logs are
   append-only. Storage failures are recorded as `company.purge_storage_failed`.

Neon point-in-time restore covers accidental purges within the project's history window.
