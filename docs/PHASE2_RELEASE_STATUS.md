# Phase 067–068 deployment and validation — 2026-10-26

## Database production status

Neon project: `odd-fire-18298965` (BUNYRA New), default branch: `br-muddy-recipe-ba50akka`.
A manual production snapshot was created **before** applying schema changes:
`snap-curly-meadow-baehpzir` (`pre-phase067-068-2026-10-26`).
Migration `067-workspace-inventory-hierarchy` and `068-contract-receipt-compatibility` were applied **together atomically** after rehearsing them on the separate `accounting-rehearsal-20261023` branch.
Production verification showed both migration markers, phases/buildings/units/receipts/receipt_cheque_events tables, forced RLS and all receipt/cheque triggers. Existing production company and contract/collection counts were unchanged.

## Tested on nonproduction branch

- Insert project, unit, tenant-isolated phase/building/geometry, customer, draft+approved pricing plan, approved booking, reserve canonical inventory, active contract and installment.
- Insert actual collection and verify a single automatically mirrored immutable receipt in the same transaction.
- Verify append-only trigger rejects UPDATE to receipts.
- Insert pending cheques, record BOUNCED and CLEARED terminal events and verify there is no extra collection.
- Test data was contained in a savepoint and rolled back.
- Rehearsed the same CTE collection-and-cheque-clear transaction used in the backend. Verified one visible cleared receipt even though the append-only source receipt plus mirrored collection receipt remain in the database.
- All these are real PostgreSQL integration tests, not mocked data. They do **not** constitute an authenticated browser end-to-end test.

## App changes

- POST/GET `/api/treasury/cheques`: uses the BUNYRA managed/Neon Auth identity and project-scoped finance permissions. No caller-provided user identity is trusted.
- PENDING issue neither increments installment paid amount nor posts cash. It locks the contract and ensures uncovered outstanding amount remains.
- BOUNCED: an append-only terminal event with a reason.
- CLEARED: calls the same `recordCollection` ledger-backed flow and appends the cheque event inside the collection transaction. A failed settlement rolls back the entire transaction.
- Existing company Treasury/Receipts UI now has pending/clear/bounce controls.
- Earlier FloorplanViewer and book/contract flows still use canonical inventory_units, approved prices and booking locks.

## Cloudflare release

GitHub Actions `.github/workflows/ci.yml` validates the main commit, then deploys to Cloudflare only if `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets are configured. The workflow never prints either secret.
If credentials are absent, CI emits an explicit notice and **does not claim deployment**.
The current BUNYRA runtime targets Cloudflare Workers via `wrangler.jsonc`, not the separate legacy Real-Estate-Workspace Vercel project.

## Remaining verification

- Browser E2E with signed-in Company Admin/Operations/Finance on the actual Cloudflare URL, including live pricing, booking approval, contract creation, receipt account posting and cheque actions, still requires a reachable deployment.
- Integration scripts pinned to the dedicated Neon fixture database cannot be redirected to production; no unsafe override was added.
- If needed, rollback the database only after assessing new data written since deployment. Use Neon snapshot restoration to a separate branch first, then plan a controlled cutover; do not blindly overwrite production.
