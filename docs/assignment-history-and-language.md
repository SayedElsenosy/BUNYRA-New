# Assignment history and interface language

The customer directory supports row and current-page selection. Assignment uses the existing company-scoped transfer endpoint, role/team permissions and audit records. Per-row results retain failed rows for retry. A contact with no opportunity needs an opportunity before ownership can be assigned.

The assignment drawer does not ask for a reason. Its optional history toggle stores `hide_previous_history` with the handoff. The current recipient sees interactions, follow-ups, transfer history and related CRM audit history from that handoff onward. Company administrators, operations, sales administrators, sales managers and the verified platform owner retain their existing authorized history scope. No activity is deleted. Existing follow-up ownership and financial records are not reassigned. A later handoff without the toggle restores visibility for its recipient. Contact details and current opportunity state remain available.

Migration 038 enforces historical activity visibility with restrictive SELECT policies under the existing tenant role. Helpers validate tenant context, are not executable by PUBLIC and use fixed search paths. Existing transfer rows default to full history. General customer interactions become available as handoff context only for scoped opportunities that have an actual transfer, retaining the pre-existing private general-note scope for unrelated contacts.

UI labels use the chosen Arabic/English language. Arabic date and number formatters explicitly request Latin digits using `ar-EG-u-nu-latn`. Currency, role and common time-zone labels are localized; underlying codes, stored amounts, user-entered names/content and technical file formats retain their values.

Validation: `npm run typecheck`, `npm run build`, `npm run test:assignment-history` (isolated database only). History checks cover recipient denial through CRM, journey and direct tenant queries, supervisor and owner access, post-handoff activity, preserved records and unchecked handoffs restoring visibility. Customer, sales and follow-up regressions also run against the isolated database.
