# Role-Aware Company Dashboards — 21 October 2026

## Delivered
- Replaces the generic Company Home screen with an original responsive BUNYRA dashboard that changes based on access and role: Sales, Sales Manager, Operations, Finance Manager/Accountant, and Company Administrator (including authorized Platform Owner browse).
- All metrics, financial values and urgent work originate from live Neon tables and are aggregated server-side with the **same permission-scoped Workspace task CTE**, not browser filters or placeholder figures.
- Sales: permitted customers/open leads/booking activity, personal or managed-team trend, signed non-cancelled contract totals and authorized calculated/earned commissions by currency; NO net collections without `finance.read`.
- Sales Manager: managed team's leads/activities, limited representative breakdown; Sales individual does not see other salespeople's data.
- Operations: pending booking approvals, available inventory and ONLY approval work items in the dashboard; no contract money without specific finance or sales entitlement.
- Finance Manager/Accountant: authorized contracts, booking receipts, installment tasks, confirmed net collections and remaining contracted amounts by currency; no unrelated CRM customer names or follow-ups.
- Company Administrator: consolidated company-scoped permitted view, team activity, reports and urgent tasks.
- Seven company-local calendar days are returned including zero-activity days, alongside secure stage distribution, role-tailored quick actions, optional currency selection and direct links to permitted pages.
- Currency amounts originate as integer minor units and are displayed separately. Cancelled contracts and offer PDFs are not sales. Confirmed collections are cumulative net receipts to date on the contracts included (not month cashflow).
- All links and controls use returned permission-checked `allowed_views`; server remains authoritative. No DB schema migration or production customer/financial data writes.

## Verification during development
- TypeScript, navigation tests, CSV/date security tests and Cloudflare-compatible CI builds; last branch HEAD check required before merge.
- Exact dashboard query executed read-only against existing synthetic Hub QA fixture on Neon DEV: returned real counts, EGP amount, team rows, urgent actions and seven-day activity.
- Additional DEV checks under `SET LOCAL ROLE bunyra_tenant` verified salesperson visibility with financial collections withheld, Operations approval-only widgets without monetary values, and Finance visibility of confirmed collections with unrelated customer follow-ups excluded.
- Prepared full SQL against Neon DEV with all 20 PostgreSQL bind parameters; verified no missing placeholder, no ambiguous unused parameter, and valid SQL types.
- Existing guarded workspace DEV test suite extended to check Sales, Sales Manager, Operations, Finance Manager, Company Admin, read-only custom roles and cross-company denial. **These guarded Node tests have not been run against a live test-credential session during this delivery.**
- Manual role-by-role UI browser and mobile testing deferred by user until final acceptance. This commit is not proof the Cloudflare live app has been deployed.

## Remaining
- Run complete guarded DB integration and live browser journeys for each role; verify fonts, RTL/LTR layout, iPhone width and dark theme.
- Load/performance checks under hundreds of concurrent employees and more granular branch dashboard drill-down.
- Later accounting ERP dashboards should build on actual general-ledger posting once the full accounting module is implemented.
