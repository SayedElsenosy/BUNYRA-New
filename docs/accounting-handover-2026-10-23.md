# Accounting handover and verified continuation

Recovered implementation: origin/main at `47d2058`, from the work associated with
the conversation “دراسة المنافسين الثلاثة”. The conversation reader timed out;
the checked-in migrations, services, screens and roadmap are the recovery source.

## Existing implementation

- One CRM customer and automatic stages; no separate visible lead/opportunity pipeline.
- Double-entry ledger, commercial finance events and explicit cash/advance mappings.
- Supplier bills, approvals and GL posting; immutable partial supplier payments.
- Bank statements/reconciliation, legal-entity period locks and journal reversal.
- Posted trial balance, income statement and balance sheet; project filters.
- Fixed assets/monthly depreciation; versioned monthly project expense budgets.

These features are implemented slices, not a claim of full Odoo parity.

## Verified continuation

An integration regression demonstrated that migration 047 posted payment journal
lines with no `vendor_id`. The overall GL balanced but the supplier-dimension
payable balance did not clear when the bill was paid.

Migration 048 replaces only the payment posting function. Both new journal lines
now retain the source bill's supplier. Existing posted journals are not rewritten.
If any environment has real payments created under 047, review their supplier
reporting/reversal strategy before enabling supplier-dimension reports there.

The wider treasury integration also failed when importing statement lines:
the invoker-mode parent guard used `FOR SHARE`, which requires UPDATE privileges
that are intentionally absent from the tenant role. Migration 049 elevates only
that trigger function (with fixed search path and no public execute privilege).
It does not grant direct statement UPDATE. The service integration verifies this
privilege boundary plus import, matching and close behavior.

Protected commercial suites exposed two additional integration gaps. Their build
harness omitted the new `booking-lead-source` dependency; it now compiles and
resolves the exact source. Company purge also did not account for captured finance
events. A company with accounting documents is now retained in archived state
with an explicit bilingual error, before any file cleanup. A company without
accounting documents can still be purged after retention; unposted captured events
and unused cost centers are removed before their commercial/project parents.

On the guarded `dev-foundation` branch (fixture identity verified):

- Supplier-payment runner: 15 assertions, including partial/full settlement,
  duplicate retry, changed-facts conflict, overpayment, journal mismatch,
  posted bill requirement, balanced GL, supplier balance, audit and role/RLS.
- Budget runner: 10 assertions for approval/retry, immutable superseded revisions,
  audit and role/RLS.
- Each new runner uses a single transaction and savepoint rollback. Its fixtures,
  posted journals and audit records do not remain after success or failure.
- Both runners are included in the protected manual Neon integration workflow.

## Production boundary and next work

Production inspection during takeover found schema 038. After the complete
protected integration run passed **182 checks**, PR #28 was merged and tracked
migrations 039–049 were applied to production. The isolated production-data
rehearsal and before/after production comparison preserved all rows in ten
business tables, including 147 inventory units and 101 plan shapes. Activation
created the default legal entity, zero journals and zero finance events; it did
not fabricate or replay financial transactions.

- Integration evidence: https://github.com/SayedElsenosy/BUNYRA-New/actions/runs/39855833691
- Isolated rehearsal branch: `br-young-glade-bas8qs8o`.
- Retained pre-activation production copy: `br-aged-wind-baixc6wq` (no compute).
- Current tracked production migration: `049-treasury-import-lock-permission`.
- Accounting, budget and supplier payment amounts use Latin digits in both
  languages, with Arabic/English currency labels appropriate to the interface.

Next dependency order:

1. Implement reliable finance-event outbox execution/retry and its operational
   visibility; current events require explicit posting and configured mappings.
2. Complete supplier credit notes/refunds/payment reversal and bank matching;
   preserve immutable originals and closed-period controls.
3. Complete AR recognition policies, cash-flow reports, payroll/expense integration,
   currency and tax/e-invoicing requirements after the associated business rules.

Refer to `odoo-accounting-architecture-2026-10-22.md` for the original roadmap.
