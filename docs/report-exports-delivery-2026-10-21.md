# Report CSV Export — Delivery (21 October 2026)

## Delivered
- **Sales & Performance Reports**: one-click CSV with **all filtered report rows** across server pagination, not just the visible 100 records. Rows retain the same grouping, status, project and representative filters as the on-screen report.
- Sales export uses **the existing authorized `salesReports()` SQL and role scopes**. Commission columns are omitted entirely when the caller lacks commission permission. Restricted-project commission amounts are zeroed by the same existing report logic.
- **Deals & Collections Insights**: separate CSV buttons for overall currency summary, project breakdown and signing-cohort timeline. No sums across currencies. Signed-contract cohort interpretation is preserved: collections shown are cumulative net confirmed collections *to date*, not cash received during the date window.
- UTF-8 CSV with BOM for Arabic/Excel compatibility, RFC4180 escaping, spreadsheet formula-injection protection, and exact integer minor-unit-to-decimal conversion.
- Protected server route at `/api/reports-export`; all report input is validated by existing report functions. Exports are never served from untrusted browser-calculated totals.
- Sales reports enforce **10,000-row maximum** with an explicit 413 error rather than producing an incomplete or silently truncated file.
- Failed requests do not download an error body. Browser downloads receive safe, fixed filenames. Responses use no-store, nosniff and attachment headers.
- No new schema migration or production data writes.

## Verification
- Branch Linux GitHub CI run 39602082583: navigation, company-date tests, new CSV format/security tests, TypeScript check and Cloudflare build: **success**.
- Read-only Neon DEV test of the exact composed sales export SQL: 2 rows returned, matching `total_rows = 2`; report totals stay independent of pagination. The test scope omitted financial commission permissions, and all commission aggregates were zero.
- New unit tests cover Arabic, embedded delimiters/quotes/newlines, malicious formula prefixes, high-precision/negative monetary decimals, commission column visibility, empty exports and currency separation.
- Existing isolated DB integration regression `scripts/test-commission-report-boundaries.mjs` extended to compare full CSV-row retrieval and pagination-independent totals. **Full DEV fixtures suite was not executed** in this session.

## User acceptance deferred
- The user elected to do interactive UI acceptance at the end of the larger development milestone. The linked browser tool is not available from this chat context; no authenticated mobile/browser session was tested.
- For final acceptance: signed-in Sales vs Finance Manager and Company Admin, project denials, RTL/LTR and light/dark, opening CSV in Excel with Arabic strings, verifying totals and sample downloaded files.

## Future optional exports
- Excel XLSX and PDF templates with logos and print layouts may be implemented after user approval; CSV is the delivered functional format.
