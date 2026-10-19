# Integration and UI update
UI reference: https://github.com/SayedElsenosy/BUNYRA (tree 277e5d7793779813c08c67c62c44f8bb8e29f823).
The original dark/light/icon brand assets and navy/gold design tokens are reused.
The current native accounts, permissions, imports, private plan storage, pricing and CRM remain in BUNYRA-New.

## Database deployment
Run the migration runner on an isolated fixture branch, then the existing production branch:
- 025-commercial-integrity: nullable immutable booking quote snapshot, NULL-safe committed-unit protection, serialized cumulative adjustments.
- 027-retired-unit-protection: rejects reactivation or rewriting of retired parent identities.
- 026-unit-lineage: private inventory-change drafts and immutable parent/child records.
Existing units and published geometry are unchanged by these migrations.
Legacy bookings without a quote snapshot cannot be silently repriced; resolve their terms explicitly before creating a contract.

## Split and merge
An authorized editor selects available mapped units on the same page, building, floor and category.
Split provides an adjustable vertical/horizontal cut. Merge requires a single connected polygon without holes.
Before/after previews and engineering areas must be reviewed. Reasons are mandatory.
Saving a draft does not change inventory or published geometry. Approval rechecks source versions, status, booking commitments and layout version under locks.
Approval retains source units as inactive/unavailable and creates new identities with no approved prices. Separate pricing approval is required before booking.
Every approved transformation records immutable parent/child lineage and retains earlier plan revisions.
Drafts can be discarded without deleting the historical revision.
No existing test-project unit boundaries are automatically altered.

## Verification
Run typecheck and the database suites on the isolated fixture branch.
test:commercial-integrity covers record ownership, project permissions, buyer budgets, booking-to-contract terms, cumulative/concurrent refunds, cancellation, split/merge, historical layouts and lifecycle cleanup.
GitHub CI builds the exact source using the Linux OpenNext Cloudflare runtime.
Production uses main, npm run build:cloudflare and npm run deploy:cloudflare.
