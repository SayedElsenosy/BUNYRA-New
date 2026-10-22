# Treasury bank statements and reconciliation — 2026-10-22

The first bank module imports statement metadata and movements using EGP integer minor units. An external bank line can be matched once to a single already-posted GL bank-account line with identical signed amount. All reconciliation is recorded without changing the posted ledger.

GET /api/treasury lists statements, bank lines and matching records. POST operations: create_statement, import_lines, match_line and close_statement. Only finance managers/company admins and authenticated platform owner have access during the first phase.

Closed bank statements reject new lines; a close verifies every line matched and opening + movements = closing. Row locks prevent import/close races. Foreign tenants cannot read matching documents via RLS.

Not yet available: OFX/CSV bank parsers, direct banking feeds, partial matching, fee/split matching, foreign currency conversion, bank charges, cash deposits, payment approvals, vendor settlement payouts, historical bank open balance validation and finance dashboards. Production migrations stay unapplied until verified.