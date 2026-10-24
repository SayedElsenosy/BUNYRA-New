# Customer statements and installment aging — 2026-10-24

The Accounting menu has an independent Customer accounts screen with two tabs.
Both require effective `finance.read` and company administrator/finance manager
authority, or authenticated platform-owner access. Scoped accountants do not gain
company-wide customer access through this screen. Every source query is tenant
bound, including customer search and downloads.

## Posted customer statement

Select an entity, customer and date range. The statement reads only posted
receivable and customer-advance account lines, in historical EGP base valuation.
Opening/closing balances, period debit/credit totals and running balances use
exact numeric arithmetic in one SQL snapshot. Transfers between advances and AR
retain both account movements and do not create a second cash receipt. Closing
receivables and advances are also shown separately. Positive net balances are due
from the customer; negative balances are in their favor. A customer with contract
installments but no posted AR entries can have a zero GL statement.

## Contract installment aging

Select a customer or all customers, a cutoff and one contract currency. Amounts
in different currencies are never summed. Buckets: not overdue (including due
today), 1–30, 31–60, 61–90 and more than 90 days. Negative installment balances
are separate customer credits and do not offset positive aging buckets.

Balances reconstruct confirmed collections plus executed settlements less
executed refunds/reversals through the cutoff. They do not read today's mutable
`paid_minor` as a historical balance. An allocated booking deposit appears once
through its collection, not again through the booking receipt. Commercial
timestamps use Africa/Cairo calendar dates. Later contract cancellation does not
remove contracts from earlier cutoffs; cancellation takes effect on its recorded
local date. The report uses the existing installment schedule, not a schedule
versioning or contract-amendment history system.

Contracts currently have company/project scope, without an accounting entity
column. Aging therefore accepts the default entity only; other entities return an
explicit error. The posted statement supports every authorized entity.

A same-query bridge shows posted AR, advances and net ledger balances in the
selected native currency (EGP lines without a native snapshot use base amounts).
The schedule-minus-ledger difference is disclosed, never automatically allocated,
posted or called an accounting error. It can include contracts without accounting
recognition, advance receipts without a contract, canceled contract advances,
manual journals, or missing customer dimensions. Pending posting events are
counted separately through the cutoff. Revenue recognition remains a separate
policy/workflow; these reports create no revenue, receivable or offset entries.

## Paging, exports and checks

Both screens page 50 movements with full totals and deterministic ordering. A
complete XLSX includes all pages, bilingual labels, exact literal-text amounts and
source identifiers. More than 10000 movements fails explicitly instead of silently
truncating. Customer search returns at most 50 choices with an explicit search
hint when more exist; searches are literal substrings, not SQL wildcard patterns.

The guarded DEV integration runner passed 16 cases: opening/running balances,
advance transfers, exact age boundaries, historical collections/refunds/reversals/
settlements, cancellation dates, currency separation/native advances/base
valuation, deposit allocation, pending posting, paging/exports, validation,
permissions, RLS and source/ledger preservation. Fixtures are suspended afterward.
Navigation checks passed 34 cases and TypeScript passed. No schema migration or
production financial fixture is required.
