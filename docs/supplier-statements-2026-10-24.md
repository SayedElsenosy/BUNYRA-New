# Supplier statements

The supplier workspace adds a separate statement tab with explicit supplier,
accounting entity and inclusive from/to dates. The report is read-only and uses
posted supplier-dimension payable GL lines, including original documents and
their correction entries. It also includes manual posted payable journals with
the supplier dimension; drafts and other suppliers/entities are excluded.

Positive balance means payable to the supplier; negative means receivable from
the supplier. Opening balance sums all earlier posted movements. Period debit,
credit and closing totals are computed in PostgreSQL numeric arithmetic. One SQL
snapshot provides totals and paginated rows. Running balances use entry date,
posting timestamp and immutable entry ID as a stable total order. Each journal
appears once even when it has several supplier payable lines or control accounts.

Finance-read authorization and existing manager/owner restrictions apply to both
screen and export. Tenant RLS remains enforced. There are no new production
tables, migrations or financial postings in this slice. This is the EGP payable
subledger, not an aged invoice report or a multi-currency supplier statement.

XLSX downloads contain the complete selected range rather than the visible page.
More than 10000 movements returns an explicit limit error and asks for a smaller
date range; it never silently truncates. Amounts are exact decimal text to avoid
Excel/JavaScript numeric precision loss. Cells contain literal inline strings,
never spreadsheet formulas, including user-provided supplier names/references.
Exports include entity, supplier, range, opening/closing totals, entry IDs and
source IDs, with Arabic/English headers, RTL/LTR, column widths and frozen headers.

Guarded DEV integration covers partial payment/correction history, cutoff and
opening balances, stable pagination, draft exclusion, vendor isolation, credit and
refund corrections, direct GL agreement, role overrides and real foreign entity
IDs. Export tests read generated XLSX files with the installed reader, verify
all pages, literal formula-like names, Arabic labels and very large exact amounts.
