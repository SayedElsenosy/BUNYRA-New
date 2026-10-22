# Cross-department financial event bridge — 2026-10-22

The unified customer, booking, contract, installment, collection and adjustment remain original business documents. Their event ledger follows a transactional outbox pattern.

- Migration 040 captures booking receipt confirmation, contract creation, collection creation, executed refunds/settlements, and commissions within the source transaction.
- A booking receipt allocated to an installment when the contract is signed is informational, not new incoming cash. An internal transaction marker distinguishes it from a user-entered receipt reference.
- Finance managers and company admins must configure cash/bank and customer-advance mapping and explicitly approve posting each eligible event. Retry and source uniqueness prevent duplicate postings.
- Customer payments debit cash/bank and credit customer advances, not immediate revenue. An executed refund reverses these sides. Signing a contract does not automatically recognize real-estate revenue.
- GET /api/finance-events returns pending/posted/informational events; POST accepts configure_mapping and post_event.
- GET /api/ledger/reports provides period trial balance, income/expense, accounting-equation and project dimensions from posted journal lines.

Not yet implemented: background posting worker, AR/AP invoice recognition/matching, banking reconciliations, vendor bills, expenses, payroll, fixed assets, Egyptian taxation/ETA, currency conversion, company consolidation, project budgets, period closing and complete IFRS/EAS reporting. These need further implementation and UAT.

Deployment caution: migration 040 is not applied to Neon production. Verify on isolated Neon dev-foundation first.