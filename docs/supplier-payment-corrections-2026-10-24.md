# Supplier payment corrections

An authorized company admin, finance manager or platform owner can correct an
erroneous posted supplier payment. Finance approval is required by the API and the
live database authority check. The original payment, GL entry and dimensions stay
immutable. One append-only reversal record links one exact posted counter-entry.

The original bill lock serializes payments and corrections. The net paid amount
excludes corrected payments, restoring the invoice amount due and the supplier
payable balance. Repeating identical correction details returns the original
correction; changing accepted details fails. Reusing the original payment key
after correction does not resurrect the payment: a replacement needs a fresh key.

Corrections must be dated on or after the original payment and in an open period.
Inactive ledger accounts/journals and failed posting roll back all new rows.
Reasons, actor, dates, original payment and both GL references remain audited.

A bank-reconciled payment cannot be corrected through this action. Bank matching
and correction share a per-entry advisory transaction lock, so they cannot both
win a race. Neither an erroneous reversed payment nor its counter-entry can be
matched later or offered as a matching candidate.

The bilingual supplier payment screen shows original and reversed payments,
the reason/date/counter-entry, and an explicit correction form. It describes an
accounting correction; this action does not execute a bank transfer or record a
real supplier refund. Supplier credit notes, actual refunds and reconciliation
amendment workflows remain subsequent work. This slice uses the existing EGP
supplier payment flow and never guesses FX treatment.

Tracked migrations: 060–062. Protected DEV integration exercises exact original
and counter-entry dimensions, concurrent duplicate requests, net invoice balances,
overpayment protection, period rollback, immutable records, role/permission checks,
and a real bank-match versus reversal race. Fixtures retain synthetic immutable
history on the guarded DEV branch and are suspended after completion.
