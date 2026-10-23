# Supplier credits and received refunds

Finance approvers can post full or partial supplier credit notes against individual
lines of a posted EGP invoice. The original invoice remains immutable. Each credit
preserves the original expense/asset, supplier, project and cost-center dimensions
on both GL sides and uses the original payable control account, even after mapping
changes. Cumulative line credits cannot exceed the original amount.

Bill balances show original amount, credited amount, net cash paid, remaining due
and supplier refund due. Posting a credit never invents a cash receipt. Recorded
refunds require an existing credit, actual overpayment, an explicitly selected
active EGP bank/cash account, date and bank/receipt reference. The operation records
money already received; it does not initiate a bank transfer. Incoming bank lines
remain available for exact reconciliation. Refund capacity is checked both now and
as of the entered receipt date, excluding later payments/credits.

The bill lock serializes credit, settlement, refund and payment correction.
Idempotency hashes reject changed replays, cumulative caps prevent over-crediting
or over-refunding, and duplicate account/date/bank-reference receipts are blocked.
Closed periods and invalid mappings roll back the whole operation. A payment
cannot be corrected if received refunds would make its net cash paid negative.
Posted notes, allocations, refunds, journals and audit history cannot be edited or
deleted through tenant CRUD.

Supplier screens use separate Invoices & payments, Credit notes and Received
refunds views. Invoice lines are fetched only for the selected posted invoice.
The credit form supports selected partial amounts and explicit full-remaining
fill; cash receipt remains a separate form. All labels are bilingual with Latin
digits. Original supplier invoice/refund account names are retained in responses.

This slice keeps supplier documents in EGP, with no guessed VAT, FX, automatic
cash movement or revenue. Corrections of posted credit notes/refund receipts and
supplier debit notes are subsequent workflows; immutable records stay intact.
Migrations 063–065 are tested on guarded DEV and rehearsed independently before
production activation. Synthetic integration journals stay in DEV only.
