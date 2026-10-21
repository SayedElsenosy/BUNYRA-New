# BUNYRA Deals Insights — Delivery and QA (21 Oct 2026)

## New financial page
- The **Deals & collections insights** screen sits next to Installments & collections, not mixed into the salesperson-only CRM dashboard.
- Active and completed contracts are grouped by their SIGNED date within the selected date range. Cancelled contracts and generated PDF offers are excluded.
- Card metrics for each contract-signing cohort: final contract value, lifetime confirmed net receipts after executed refunds/reversals, outstanding balance (floored at zero) and excess receipts.
- Each currency is displayed on separate tabs. Never sum EGP with USD. Financial figures shown in major units with exact minor-unit computations on Neon.
- Comparison chart by contract signing period and project table; date presets in company's timezone; project/salesperson filtering; Arabic/English, RTL/LTR, light/dark and responsive.
- Read-only API scoped server-side to **both** `reports.read` and `finance.read`, with effective company + project permission checks and salesperson scope. No financial data is fetched if the user fails either capability.
- Returned results are full-cohort aggregates; nothing is extrapolated from paginated UI rows.

## Verification completed
- Prior `main` CI success verified: 80744bd (navigation + timezone tests + TypeScript + Cloudflare).
- Browser-linked session attempt failed: connector requires originating browser context, unavailable from this chat. **No authenticated interactive browser validation has been claimed.**
- Reviewed existing Sales Reports rendering: bilingual filters, true trend data and detailed report table, with empty/loading/error states; existing recorded DEV report tests remain available.
- Direct **read-only** Neon `dev-foundation` queries using the exact new Deals Insights SQL confirmed:
  - 3 active contracts in one QA cohort split EGP (1) / USD (2), no cross-currency totals;
  - Another fixture correctly shows 100001 minor-unit contract, 20000 minor-unit net collections, 80001 minor-unit outstanding, across matching project and trend totals.
- Extended existing DEV-only Commission Reports integration tests for finance-only permission boundaries, foreign project/company denial, project-specific finance denial, cancelled contract exclusion and EGP/USD separation. **These integration test scripts require DEV test fixture environment and have not been executed end-to-end in this chat.**
- Navigation role permission tests extended for `deals-insights` default Sales denial, company admin / finance manager allowance, company/project explicit denials.
- GitHub CI runs TypeScript, navigation role tests, date tests and Cloudflare production-compatible Linux build before merge.

## Remaining acceptance tests
- Log in with *test* Sales, Sales Manager, Finance Manager and Company Admin roles on a non-production environment; confirm Sales cannot navigate or GET this page unless explicitly granted finance scope, project denials hide amounts, and finance/admin see permitted data only.
- Real responsive visual review at 390px, desktop widths, RTL/LTR and light/dark; keyboard/focus test for buttons, filters and chart alternatives.
- Run the full isolated test:commissions-reports suite on a clean Neon DEV fixture; validate all formula checks including reversals and refunds.
- Production deployment verification is separate from merging GitHub commits. No production financial records or database schema were modified by this feature.

## Metric interpretation
This is a **cohort** report. Changing the date range selects contracts by signing date; the collected figure remains net receipts on those selected contracts up to now. This is NOT a cashflow report of money collected DURING the date window.
