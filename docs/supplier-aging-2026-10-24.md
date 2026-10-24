# Supplier payable aging

The supplier workspace adds a separate payable-aging tab with legal-entity,
optional supplier and as-of-date filters. Open posted invoices are classified by
their due dates: not overdue (including due on the cutoff), 1–30, 31–60, 61–90 and
over 90 days. Positive invoice payables and negative supplier receivables remain
separate; a credit on one invoice never hides overdue debt on another.

Historical invoice balances use invoice/payment/credit/refund accounting dates.
A payment, credit or refund remains effective before its correction date and is
excluded on and after that correction date. Later settlements or corrections do
not rewrite earlier cutoffs. Draft/approved-but-unposted bills, future invoices
and other entities/tenants are excluded. Fully settled invoices are omitted.

Invoice balances are compared with the posted payable GL at the same cutoff and
scope, in the same SQL snapshot as totals and the invoice page. Manual payable
journals and other differences are reported explicitly as an unallocated ledger
difference; they are never allocated to invoices automatically. The all-supplier
scope includes unassigned-supplier payable journals in that difference. A supplier
filter includes only that supplier's GL dimension. This is EGP invoice aging,
not a supplier FX report or an automatic settlement/reclassification workflow.

All amounts use PostgreSQL numeric arithmetic and exact decimal-string formatting.
Pagination is stable by due date and immutable invoice ID. Summary totals cover
the entire filtered report rather than the visible 50-row page. Complete XLSX
exports contain all invoice pages, bilingual labels, cutoff/scope metadata, five
bucket totals and the GL comparison. More than 10000 open invoices returns a
limit error rather than a truncated download. Literal XLSX cells preserve large
amounts and prevent names/references from being executed as formulas. The shared
XLSX writer retains the existing supplier-statement layout and safeguards.

Finance-read plus manager/owner authorization and forced tenant RLS apply to both
screen and export. This slice is read-only: no database migration or production
financial posting is required. Guarded DEV tests cover exact bucket boundaries,
all historical correction cutoffs, separate receivables, entity/tenant isolation,
manual and unassigned GL differences, draft exclusion, full pagination, XLSX
roundtrips and permission overrides. Existing statement/export tests also run.
