# Foundation batch A — project-scoped accountant authorization (2026-10-22)

Repository: SayedElsenosy/BUNYRA-New, main. Cloudflare Workers + Neon PostgreSQL.

## Behavior
- Standard accountant project-scoped actions (projects, bookings, finance, commissions, and reports) require explicit positive per-project `member_permissions` for each action. A company-level grant alone does not unlock every project. A company-level deny overrides project grants; custom roles must also allow the action.
- Finance manager, company admin, sales, and audited platform-owner privileges are unchanged.
- Finance-only accounts no longer receive the unrelated company-wide CRM customer directory through `commercialOverview`. Authorized booking/contract records keep their usual visibility.
- Navigation exposes finance screens only when the user has a matching project grant (where project records exist).

## Testing
- Extended the navigation test with denied-by-default, per-project allowance, company-deny, custom-role and finance-manager checks. This test already runs in GitHub CI.
- Updated the isolated finance and commercial-integration fixtures to grant their accountant an explicit test project; added regression checks for default denial and CRM directory protection.
- Database-backed integration suites are **not part of the default CI** and must run on an isolated Neon fixture branch. Do not run on main.

## Operations and limits
- Main Neon branch read-only inspection found zero active accountant memberships before this code change, so there were no active accountant logins to migrate. Before onboarding an accountant, assign allowed actions per project using the existing permissions UI.
- Department/cost-center authorization remains future work requiring accounting records with explicit scopes.
- No production DB writes, migrations or hosting configuration changes were performed by this commit. A successful CI build alone does not confirm production deployment.
