# GL-backed supplier bill settlements — Odoo-inspired AP phase C extension

- Migration 047 adds posted-only supplier settlements, allowing exact partial payments and re-tries with a stable idempotency key.
- PostgreSQL holds the posted vendor bill row lock for the payment, checks remaining amount, validates active payable/cash/bank accounts and a matching cash/bank journal, posts balanced Debit Payables / Credit Cash or Bank GL lines and writes an audit record atomically.
- Payments are immutable. A retry with the same key and same facts returns the existing payment; a reuse with different facts is rejected. Overpayments and paying unposted invoices are rejected.
- Backend finance.approve plus PostgreSQL active membership/role check; tenant RLS forced on payment table, no direct insert/update/delete grants to tenant.
- API POST /api/vendor-payables operation pay_bill. GET vendor bill rows include exact paid and remaining amounts and recent payments.
- This is **not** bank statement reconciliation by itself, and refund/reversal accounting and supplier credit notes need separate audited workflows.
- Migration is **not** applied automatically to Neon production; test on a development branch and run protected integration workflow before rollout.
