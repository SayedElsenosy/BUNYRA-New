# Foundation A: SQL-bound booking access and safe commercial responses (2026-10-22)

- Booking IDs are now selected only for the caller's authorized projects and salesperson IDs, applying both predicates in SQL before returning data to JavaScript.
- If the authorized project set is empty, no booking-table query is executed.
- Contract lookups still recheck the linked booking before releasing data.
- The commercial overview no longer serializes the internal access context (custom role permissions or per-user overrides) to the browser; explicit capability booleans are preserved.
- CI tests cover accountant project grants and denials, sales ownership, finance manager visibility, owner browsing, and contract restrictions without using a production database.
- Independently on Neon dev-foundation, read-only RLS test as a test-company member returned 1 own project, 0 foreign projects, 0 foreign companies, and 1 from an unfiltered project query.
- On Neon main, snapshot scheduling was empty and no manual snapshots were returned. A recovery drill remains outstanding.
- This patch changes no schema, production records, credentials, or hosting configuration.
