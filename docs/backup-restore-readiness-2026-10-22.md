# BUNYRA recovery readiness — Neon and object storage

Date: 2026-10-22. Repository: SayedElsenosy/BUNYRA-New. This is a safety runbook, not evidence that a recovery drill has already passed.

## Current verified state
- Neon project: BUNYRA New, production branch `main` (`br-muddy-recipe-ba50akka`), isolated fixture branch `dev-foundation` (`br-soft-wildflower-bafc3fd0`).
- Neon reported `history_retention_seconds=21600` (6 hours) at inspection; this limits the currently advertised PITR history.
- Main branch automatic snapshot schedule was empty; project snapshot list was empty. There is no verified durable backup or successful restore test yet.
- Application uses Cloudflare Workers/OpenNext and separate storage capabilities; recovery must verify stored files in addition to relational records.

## Safe non-destructive restoration drill (not yet run)
1. Confirm project plan limits and whether creating additional Neon snapshot/branch incurs charges or uses quota; obtain approval if a charge or production resource adjustment is required.
2. Create a manual Neon snapshot of the chosen isolated development branch (not the production branch). Record snapshot ID and time in a restricted operations log.
3. Restore the snapshot to a NEW temporary branch, never onto the original branch, and never switch default branch.
4. On restored branch, run read-only SQL checks for schema_migrations count, projects/companies/units/bookings/contracts counts, active booking uniqueness, installment balance consistency, and tenant role RLS policies.
5. Verify application authentication configuration, Cloudflare Worker bindings and linked object storage in a separate test environment; do not send live customer notifications or payments.
6. Record observed recovery time, data age, missing dependencies and mismatches. Only then define realistic RPO and RTO for customers.
7. Delete test resources only with explicit authorization and once evidence and costs are reconciled. Do not touch primary Neon main or production Cloudflare bindings.

## Before commercialization
- Approve retention targets and costs, scheduled snapshots/backups, recovery key custodians, disaster recovery contacts, and recurring rehearsal cadence.
- Keep DB secrets, storage credentials and Cloudflare tokens out of GitHub code and audit notes.
- Never claim automatic backups, recovery points, or production deploys based on successful CI or a read-only check.
