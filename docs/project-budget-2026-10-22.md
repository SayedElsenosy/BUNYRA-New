# Project budgets vs actuals — accounting phase D (2026-10-22)

- Original BUNYRA module inspired by integrated Odoo accounting/analytic budgets, **not** an Odoo code copy.
- Migration 045 creates entity- and project-scoped monthly expense-account budgets with draft/approved/superseded status and immutable version history. Budgets are EGP integer piasters and apply only to expense accounts. Approving a revision supersedes the old approved version atomically.
- Approving requires finance manager or company admin (or authenticated platform owner) both in API and in the PostgreSQL security-definer approval routine.
- Reports include **only posted** expense journal lines tagged with projects, grouped by project, expense account and month. Unbudgeted project spending is shown as zero budget with actual spending. Expense GL entries without project tags are excluded and must be handled during reporting review.
- New API GET/POST at /api/ledger/budgets for viewing, drafting and approving; no hidden automatic GL posting or release of customer data.
- Forced RLS and company/entity/project composite FKs prevent cross-tenant references. Direct UPDATE and DELETE privileges are not granted to application tenants.
- Migration 045 is **not deployed to production** by CI. First verify on isolated Neon branch and test role-level execution, approval revision and variance math, then plan commercial activation and backup.
- Remaining Odoo-inspired work: AP supplier payments and partial reconciliation; reliable outbox execution; payroll and HR; Egyptian tax/ETA; multicurrency; project budget commitments, purchasing approvals and forecasting; production UAT and disaster recovery.
