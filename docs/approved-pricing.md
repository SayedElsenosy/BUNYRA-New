# Approved price lists and payment plans

Open Company → Inventory → Price lists & payment plans. Company admins and Operations can prepare a draft, select eligible units, review their proposed prices, and choose the payment plans allowed for each unit. Saving never approves the draft. Company admins and platform owners can approve; Operations requires a separate pricing.approve grant. Sales roles read approved lists only.

Approval publishes one current immutable snapshot per project. A new approval replaces the current pointer while retaining historical lists. Units omitted from the current list have no approved price. Changes to unit versions require price review and a new approval. Concurrent edits and approvals require the expected book version and project revision. The audit log records draft contents, actors and approval revisions.

Each plan has a down payment percentage, installment count, month interval and a positive surcharge or negative discount percentage. Cash requires 100% down payment and zero installments. All amounts are calculated in integer minor units. Installment remainders are distributed without losing cents, and due dates preserve the original day where the month allows it. The calculator creates no reservation, contract or financial obligation.

Approved pricing is available in the inventory and when opening a linked unit on the interactive plan. This change does not alter drawing geometry or populate real prices.

Apply db/015-approved-pricing.sql before deploying application code. Run npm run test:pricing against an isolated development database with BUNYRA_TEST_DATABASE_URL and BUNYRA_ALLOW_TEST_FIXTURES=1. The suite refuses databases with a non-fixture platform owner. Never run fixture suites on production.
