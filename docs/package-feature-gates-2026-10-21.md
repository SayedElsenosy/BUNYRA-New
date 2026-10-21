# BUNYRA — Tenant package feature enforcement (incremental batch, 21 Oct 2026)

## Goals
Prevent direct HTTP requests from bypassing package-disabled features. Authorization is two-step:
1. `requireEntitled()` verifies company membership or a **verified** Platform Owner bypass via normal `access()`, then checks the company's subscribed feature.
2. The underlying domain service still enforces its own action, project and record permissions. UI hiding is never relied on for API authorization.

## Implemented gates
- **crm**: `/api/crm` GET/POST/PATCH, `/api/sales` GET/POST, `/api/follow-ups` GET/POST, `/api/lead-routing` GET/POST, `/api/customer-journey` GET and Saved Offers issuance/read.
- **inventory**: `/api/inventory` GET/POST, `/api/inventory/import` POST, `/api/unit-transformations` POST, `/api/pricing` GET/POST and offer issue creation (which depends on inventory).
- **floorplans**: `/api/plan-layout` GET/POST, `/api/plan-files` GET/POST, `/api/plan-files/upload` POST/PUT.
- **buyer_matching**: `/api/buyer` GET/POST.
- **commissions**: `/api/commissions` GET/POST and masked financial commission summary on role dashboard when disabled.
- **advanced_reports**: existed prior to this batch on Sales Reports, Deals Insights and CSV exports.
- Company workspace navigation and role dashboards now both use the same shared subscription view filter for the mapped features, plus safe masking of CRM dashboard counts and team rows when CRM is disabled.
- Legacy companies with **no company_subscription row** retain their existing experience. Staff in assigned subscriptions are denied features unless explicitly true.
- A Platform Owner passes through only after `access()` verifies the platform-owner identity.

## Limitations and next batch
- `finance_erp` represents the **future general ledger/ERP accounting module**; it must not block core booking/contract/collection activity already sold as the core CRM workflow.
- `whatsapp` remains contract metadata, not a connected messaging integration.
- Some cross-cutting shared Workspace, business, exports and notifications APIs may still expose **record summaries or indirect actions** related to otherwise disabled modules. Before selling plans with these disabled features, complete and test those alternate endpoint boundaries rather than treating this batch as comprehensive.
- Field-level finance access and tenant-project RLS remain independent mandatory checks.
- Automated navigation/route gate regression tests are run in CI. They are not a substitute for full guarded DEV HTTP tests with at least two tenant identities, platform owner, concurrent usage, and browser UX acceptance.
- No database migrations or subscription assignments are required in this batch; existing production company settings remain unchanged.
