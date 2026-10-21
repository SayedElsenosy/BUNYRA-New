# BUNYRA — Scoped sales insights (21 October 2026)

## Delivered
- Sales & Performance Reports include a responsive chart for recorded calls, booking requests and non-cancelled contracts, plus top-10 representative activity table.
- All chart values come from same server-side scoped `grouped` CTE as report; aggregates use full selected period regardless of report page.
- Representative comparison uses counts only; no cross-currency summation. Existing permission-checked commission visibility remains unchanged.
- Quick date presets: Today / This Week (Monday-first) / This Month / Last 30 days, computed in company timezone.
- BUNYRA dark/light tokens, Arabic/English, responsive layout, readable report table and empty states.
- No migrations and no production data writes.

## Validation
- CI checks: navigation, report date presets, TypeScript, Linux Cloudflare build.
- Date tests cover Cairo/US timezones, midnight, Monday-first, month and leap year.
- Existing DEV integration scripts extended to compare trend with full totals, individual salesperson scope, and non-first page.
- Read-only full SQL query on Neon DEV verified trend/count consistency and expected output fields.
- Second read-only DEV test simulates single rep scope plus denied commissions; confirms safe output and page-independent totals.
- SQL validation used preexisting synthetic DEV fixtures; no records changed.
- Full test:db, browser journey and production load tests were not run in this delivery.

## Remaining
- Event drill-down and accurate full-range Excel/PDF exports.
- Targets and forecasting only after business rules approval.
- Dedicated Operations and Finance dashboards; browser acceptance review.