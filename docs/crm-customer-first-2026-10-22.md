# CRM customer-first redesign (2026-10-22)

**Approved direction:** customers and leads must not be separate user-visible objects, no standalone sales pipeline, and no redundant note/contact or opportunity buttons. One directory row per customer. Customer stage filter stays above the directory. 'Add Action' records a contact result, changes the customer's stage and optionally schedules the next follow-up in one audited write.

## Implementation
- Customer creation from the CRM API atomically initializes the backend stage record at Fresh.
- Separate lead creation API is discontinued (410). Old integration-facing service functions stay internal temporarily because bookings, receivables, ownership and reporting use lead identifiers.
- CRM directory renders each unique customer once, deriving its current stage from its assigned internal stage record; a customer with no record defaults visually to Fresh.
- Removed Add Opportunity, Log Note / Interaction, Log Call, Log Meeting and Schedule Follow-up duplicate shortcuts from customer screens. Phone, WhatsApp, email quick links and Add Action remain.
- Removed the separate Sales pipeline and lead analytics from company navigation and effective navigation permissions. Deprecated deep links resolve to Customers. Stages configuration remains under settings.
- Relabeled sales management UI from leads/opportunities to customers.

## Data handling
- No production customer deletion or database migration was run. Existing bookings, contracts, collections and audit records reference CRM records. Since historical CRM records are not required, a separately scoped clean reset may be performed after auditing FK dependencies; **do not truncate referenced tables blindly**. Any such destructive SQL needs explicit approval.
- CI navigation tests cover the removed pipeline routes. CRM integration suites should be run again on the isolated Neon dev-foundation test branch.
