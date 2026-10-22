# Unified customer CRM — batch B (2026-10-22)

The customer directory is the only sales record exposed to users. New customers created through the CRM API automatically receive a technical initial stage record (stage `fresh`) in the **same transaction** as the customer and audit entry, so 'Add action' works without a separate 'create opportunity' step. Existing internal lead IDs remain a technical compatibility mechanism for bookings, notifications, follow-ups, and reporting, not a second user-facing entity.

- The public CRM POST operation `lead` now responds `USE_CUSTOMER_RECORD` (410).
- The underlying `createCustomer()` retains an optional initialization flag so existing imports/fixtures that create their own specific lead sources aren't inadvertently doubled. CRM route always enables it.
- No production deletion is performed by this code change. Destructive cleanup of existing CRM data and all dependent foreign-key references must be separately scoped; the user has indicated no need to retain previous CRM records, but that does not authorize deletion of booked contracts or financial/audit data.
