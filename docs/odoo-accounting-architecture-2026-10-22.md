# Odoo-inspired Accounting and Cross-Department Architecture — BUNYRA

Scope: Full standalone SaaS for real-estate developers. Source inspiration: Odoo 20.0, modules sale, sale_crm, sale_stock, account, account_payment, purchase, analytic, hr_expense and Egyptian localization. This is an original PostgreSQL/TypeScript implementation, not a copy of Odoo ORM. Review LGPLv3 and per-module licenses before any direct code reuse.

## Approved commercial workflow
- There is **one CRM customer**, with customer stage and Add Action; no separate visible Lead, Opportunity or pipeline. Do not resurrect removed lead screens.
- Sales selects an approved unit and payment plan and submits a booking; Operations approves and locks the unit; Accounts records/acknowledges receipt without auto-releasing an Operations-approved booking; Contracts signs and creates a fixed installment schedule.
- Commission amount is the final contract amount × contract-specific rate. Eligibility is determined by a snapshotted confirmed-net-collection threshold; reversals are posted, never history-erased.
- Every business event carries company_id, project_id, customer_id, source document id, actor, approved timestamp, idempotency key and immutable pricing/commission terms.

## Accounting architecture
1. One tenant/company boundary. Optional subsidiary legal entities; the default entity is MAIN. Each legal entity has a chart of accounts and journals; a company can consolidate across its entities.
2. Ledger is **double-entry**, not a financial status table. One journal entry has at least two lines with integer minor-unit debits and credits. Posting rejects out-of-balance entries. Posted entries and lines are immutable.
3. Analytical dimensions (project and cost center) are stored per journal line, never implemented as incompatible separate project general ledgers. A customer/contract reference ties AR and receipts to the original buyer and project.
4. Cash and bank accounts, receivable/payable subledgers, invoice schedules, invoice-payment reconciliation and tax subledgers derive from posted GL events. In-progress operational bookings do **not** automatically mean recognized revenue.
5. Business-to-ledger integration will use a transactional event/outbox and exactly-once ledger posting keyed by (company, entity, source type, source document, event kind). Consumer retries must never duplicate entries; an adjustment/cancellation creates a reversal, not an UPDATE to a posted journal.
6. Tenant RLS applies to each table. Posting requires verified company/user context and finance-manager/company-admin authority; ordinary accountants will receive only project/department grants when record-level financial scopes are ready.

## Delivery milestones
| Phase | Functions | Acceptance |
| --- | --- | --- |
| A GL foundation | entities, chart of accounts, journals, cost centers, draft lines, balanced posting, audit, immutable journals, idempotency, project dimensions | test same/foreign-tenant isolation, zero/unbalanced postings, concurrent duplicate posting, immutable posted lines |
| B Integrated finance events | booking/receipt/contract/collection/adjustment/commission adapters, reliable event outbox, posting policy mapping | one business event exactly one balanced ledger event; reversal and retry coverage |
| C AR, AP, banks | customer receivables, vendor bills, suppliers/contractors, bank/cash ledgers, partial matching and reconciliation, refunds | account balances reconciled to documents and bank |
| D Project reporting | profit/cost centers, project budgets, consolidated legal-entity/company views, drill-down trial balance/P&L/BS/cash flow | sum of projects agrees with company ledger; multi-entity trial balances |
| E Full ERP | expense workflows, payroll, fixed assets/depreciation, Egyptian tax/ETA integration, multi-currency/FX, accruals, closing, period locks | accounting policy review, UAT, separation of duties and migration tests |

## First code slice
- 039-ledger-foundation.sql creates isolated ledger tables (legal entities, account chart, journals, cost centers, entries, lines), company-scoped keys, RLS, immutable-posted entry/line triggers and guarded posting function.
- Monetary values are **EGP integer minor units** in the initial slice. Other currencies require explicit FX and reporting-currency accounting before activation.
- CI tests cover exact arithmetic, invalid entry shapes, static RLS and protected posting invariants.
- **The migration is committed but is not applied automatically to Neon production.** No general-ledger UI or automatic sales postings are claimed at this stage. Apply and test on an isolated Neon branch before rolling out; full accounting is not complete.
