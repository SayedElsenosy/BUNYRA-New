# Project setup drafts (request 7 foundation)

The company project wizard saves and resumes six stages: metadata; phases/buildings/floors with hosted HTTPS plan references; categories and unit drafts; proposed prices and payment plans; finance defaults/notes and project permission guidance; review.

`project_setups` stores a validated, versioned JSON configuration under a composite tenant/project foreign key. Company row locking serializes draft mutations; optimistic versions reject stale saves. Creation, renaming, configuration changes and audit snapshots commit atomically. Project codes are unique per company without case distinctions. The server validates unique child codes and all hierarchy references. No cross-company project can be written. Read-only project users receive no draft commercial configuration. No fake operational data is seeded into production.

Run migration `db/004-project-setup.sql` once per branch. Run `npm run test:projects` with BUNYRA_TEST_DATABASE_URL pointing to an isolated test branch and BUNYRA_ALLOW_TEST_FIXTURES=1. Fixtures remain in that branch; never target production.

Money is parsed into integer minor units. The shared calculation helper uses BigInt, rounds the initial down payment half-up, and allocates remaining cents over installments so totals match exactly. Payment frequency is stored in whole months. These are proposed plans, not approved financial obligations.

This release deliberately has no publication endpoint. Draft units are not sellable inventory. Inventory status transitions, bookings, approved price list versions, unit-specific allowed plans, discounts, interactive polygon drawing, uploads and plan publication are later modules. Plan URLs are references only and do not cause server-side fetching. Staff permissions continue through the existing Accounts & permissions panel; organizational placement does not grant project permissions. Saving a project never creates staff memberships or invites.
