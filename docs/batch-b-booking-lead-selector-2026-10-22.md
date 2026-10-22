# Batch B: choosing an authorized CRM lead during booking (2026-10-22)

The booking service now verifies the lead's customer, project and salesperson permissions. This patch makes that relationship available to users through the commercial booking form.

- Existing booking form supports an optional sales lead selector. The default is a direct booking without a linked lead.
- The selected lead is reset when the customer or project changes.
- For bookings initiated from a saved offer, the user can also select an eligible lead.
- Commercial API selects only leads for visible CRM customer IDs, project scopes and salesperson/team memberships. The SQL limits the list to 1,000 recent records, a temporary UI bound; this is not yet a dedicated paginated lead lookup.
- Finance-only users do not receive CRM lead choices.
- Backend checks remain the source of truth and reject forged lead IDs.
- Two Neon integration regression cases cover seller isolation and finance redaction. The updated workflow must be manually run on the isolated dev branch; the standard push CI covers TS/build.
- No schema migrations or production data mutations.
