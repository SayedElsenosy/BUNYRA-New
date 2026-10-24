# Supplier credit-note and received-refund corrections

Finance approvers can correct a mistakenly posted credit note or supplier refund
through a full counter-entry, without editing its source document. The original
accounts, dimensions, native currency amounts and historical exchange rates are
copied with debit/credit and native signs inverted. Each source permits one
immutable correction with date, reason, actor, audit record and journal reference.
Identical retries return the accepted correction; changed retries conflict.

All supplier payments, credits, receipts and corrections serialize on their
original invoice. Credit correction is refused while a linked refund is active,
or when its date precedes a linked refund correction. A receipt matched to a bank
statement cannot be corrected here. Bank matching and corrections share the
entry lock, so only one can win concurrent requests. Corrected originals and
counter-entries cannot subsequently be matched, and are absent from candidates.

The payable balance and invoice-line capacity count active credits and receipts.
Correcting a receipt restores refund capacity; correcting a credit restores
invoice value and line capacity. Neither old posting key can revive a corrected
document. A replacement document needs a new reference/key. Backdated refund
requests cannot consume capacity released by a later receipt correction. Closed
periods roll back the entire attempted correction.

Company/owner views retain the existing separate credit-note and refund tabs.
History includes correction date, reason and journal reference. Linked refunds
and bank matches explain why an action is unavailable. A correction form requires
an explicit posting action and does not initiate any bank transfer. Arabic and
English labels use Latin digits. EGP supplier scope remains unchanged; supplier
debit notes, tax and FX purchasing are separate future workflows.

Migration 066 is additive and rehearsed on the isolated production-copy branch.
Integration coverage exercises retries, exact source allocation, reopened capacity,
bank races, dependencies, period rollback, authorization overrides, RLS and
immutable documents. Synthetic financial records remain on the guarded DEV branch.
