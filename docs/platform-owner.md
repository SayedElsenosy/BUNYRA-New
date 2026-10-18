# Platform owner console (Request 3)

- `/api/platform` (GET/POST/PATCH) is reachable only when `platformIdentity()` confirms the signed-in user is in `platform_owner`. Company users get 403; the owner identity is separate from company memberships.
- Company overview: `companyOverview()` (lib/bunyra/platform.ts) returns company data, settings, projects with unit counts, members (active/disabled), branches (`organization_nodes.kind='branch'`), unit counts by status, valid pending invitations and the last 20 company changes. Every call writes a `company.view` audit entry.
- Inside the overview the owner works in the company's own panels (projects, inventory, organization/settings, team) with `mode=platform`. Each request writes `platform_owner.company_access` and runs under the tenant RLS scope of the selected company only.
- Audit log: `platformAudit()` supports filtering by company and hiding browsing entries (`company.view`, `platform_owner.company_access`) to show changes only. Audit entries cannot be changed or deleted (migration 009).
- Subscriptions and seats are not implemented yet (Requests 30 and 31); the console shows real user counts only.

Tests: `npm run test:platform` (scripts/test-platform.mjs), test database only.
