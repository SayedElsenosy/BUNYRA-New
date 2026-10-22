# Batch B — CRM lead to booking integrity (2026-10-22)

The current customer → lead → buyer request → saved offer → booking → contract → collection pipeline already exists. This patch protects the optional booking `lead_id` field, which previously depended on a company-only database FK without matching buyer/project/employee ownership.

- For any supplied lead ID, the caller must have `leads.read`; the lead must exist within the target company and be visible in the caller's sales/team scope.
- The lead must belong to the exact booking customer and, if the lead is project-scoped, its project must match the booked unit's project. Projectless leads are allowed for conversion into project-specific bookings.
- Rejection uses `INVALID_JOURNEY_SOURCE` (403) before booking transaction, to avoid leaking whether private leads exist.
- Existing approved price calculation, buyer request/source offer checks and booking locking remain unchanged.
- Added pure CI regression tests and real Neon integration scenarios, including cross-seller, cross-customer, cross-project, nonexistent and valid lead.
- Neon integration tests require manual isolated workflow execution; ordinary CI covers the pure scope check, TypeScript and Cloudflare build.
- No migration or production data changes.
