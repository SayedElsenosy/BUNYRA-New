# BUNYRA — Saved offers and booking context · 21 October 2026

## Delivered
- A separate Saved Offers sidebar section, with SQL-scoped counts and 20-row pagination, exact record links, original PDF downloads, and customer/buyer-request links.
- Issue an offer from a matched unit and its chosen approved payment plan. Customer, request, project, unit, plan and down-payment date carry into a booking. Historical anonymous offers remain downloadable and require a customer-linked offer before conversion.
- Offer numbers use the company time zone. Original issue-time customer identity, approved quote, document bytes, size and SHA-256 are retained. Contact changes and later pricing revisions do not rewrite the issued PDF.
- Original PDFs use the existing private Neon project-plans bucket under company/offers keys. No credentials or bucket access settings change. Failed uploads remain hidden and retain cleanup metadata.
- Issuing an offer does not reserve inventory or create revenue. Booking is a separate explicit request, followed by existing Operations and Accounts steps.
- A stale price, plan, unit version or availability blocks new booking from that offer. An existing authorized booking is opened instead of offering another booking. Concurrency uses existing unit locks and active-booking uniqueness.
- Booking source columns and frozen JSON references agree and cannot be changed later. Contract creation preserves original booking terms, source identifiers, original customer and salesperson/commission rules.
- Owner, company, team, own salesperson, custom-role and per-project read boundaries remain authoritative. Financial-only accounts do not gain customer/offer access. Object keys never appear in public responses.
- Customer 360 adds an Offers tab and timeline entries according to pricing/inventory/project access. Company retention purge includes offer rows and retryable private-object cleanup.

## Verification
- 31 saved-offer checks, including source integrity, concurrency, immutable original downloads, storage failure, project/team/tenant boundaries, stale quotes, three-role booking→contract flow and company purge.
- 30 workspace, 29 Customer 360 and 38 commercial regression checks.
- 23 navigation/permission checks and 6 HTTP authentication/CSRF/method checks.
- Total automated checks: 157.
- Actual Neon DEV private storage: upload/download 200 with identical bytes; unsigned object access 403. Browser route storage is a guarded local S3 test double, never production storage credentials.
- Browser: request→unit→saved offer→original PDF→prefilled booking→one submitted booking; browser PDF checksum matches the stored offer. Role write tests use synthetic DEV data only. No external customer message is sent.
- Arabic PDF visual review: one page, reference, customer, brand, price and installment table legible. Existing oversized multipage Arabic regression passes.
- Migration 029 is additive, tested first on the existing DEV branch. Production migration, Linux build, merge and deployment evidence are recorded after verification.

## Remaining work
Kanban drag/drop, move reasons/atomic stage audit, SLA/recurring follow-ups, formal side-by-side comparison selection, customer attachments, and the remaining PDF roadmap are subsequent work. Historical offers issued before this release were on-demand documents and cannot be reconstructed as original stored files; saved history starts with this release.
