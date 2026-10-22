# Supplier and contractor bills — Payables foundation (2026-10-22)

Ledger-connected supplier records, invoice/bill drafts with project-cost-coded lines, manager approval, and immutable balanced posting. Vendor payable is credited for each coded cost line, so a project's subtotal remains balanced.

API: GET /api/vendor-payables lists suppliers, invoices and configured payable journals. POST operations: vendor, bill, approve_bill, payable_mapping, post_bill. Only company admins, authorized finance managers and platform owner can access the initial API; project-scoped accountants will be enabled after row-level project grants and UX are implemented.

Accounting: Approval is distinct from posting. Posting validates source amounts against lines, expense/asset account and payable mapping, then writes a balanced journal via the existing protected GL procedure. Retry yields the same entry and no extra audit log.

Migration 041 is additive and not deployed to production. Further features required: disbursements against supplier bills, outstanding payable reconciliation, due-date aging, tax handling and vendor payment bank matching, procurement purchase orders, payroll and expense workflows. This phase is NOT the whole ERP.