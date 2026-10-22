# Fixture-test production safety guard — 2026-10-22

## Why
All BUNYRA database integration suites create test customers, bookings, receipts, or permissions. Prior runners typically checked only that BUNYRA_TEST_DATABASE_URL and BUNYRA_ALLOW_TEST_FIXTURES=1 were present. An accidentally supplied production URL could therefore cause unwanted fixture writes.

## Enforcement
- All 26 run-*-tests.mjs scripts now call scripts/test-fixture-guard.mjs before any database test fixture code executes.
- The guard requires an explicit test database URL and fixture opt-in flag.
- It rejects a target endpoint matching DATABASE_URL or MIGRATE_DATABASE_URL when those are available.
- It verifies, through a read-only query, that the database contains exactly the designated test platform-owner identity: identity-test-platform-owner.
- Real production databases with another owner, or an empty production database lacking the marker, fail closed.
- File/storage integration suites retain their additional branch and storage safety checks.
- The CI pipeline runs nine database-free guard unit tests on every push.

## Database verification in this batch
- Read-only Neon dev-foundation checks found zero duplicate active unit bookings, zero invalid installment amounts/statuses, zero contract/booking identity mismatches, zero configured commission total mismatches, and zero abnormal ledger balances under the checked conditions.
- The partial unique index bookings_active_unit is present and applies to submitted, approved, accounts_pending, and accounts_confirmed bookings.
- Main branch's backup snapshot schedule was empty; no snapshots were returned when checked. Neon project history retention is six hours. No backup restoration drill was run or claimed.

## Remaining
- Full Node integration runs require access to a dedicated test branch connection secret in an isolated runner. They have not been executed as part of this patch.
- A multi-session concurrency load test and documented backup/restore exercise are still needed.
- No production database records, schema, hosting settings, or account credentials were changed in this commit.
