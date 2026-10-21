# BUNYRA SaaS packages — foundation delivery (21 Oct 2026)

## What has been implemented
- Owner-only **Packages & subscriptions** screen in Platform Console. Create/edit catalog plans (Arabic/English, monthly/annual, currency, quote/price, included seats, included projects and feature flags) and assign a plan to a company with company-specific total seat/project caps, agreed amount and contract date/status.
- Additive migrations `033-saas-package-foundation` and `034-pending-invitation-seat-reservations`.
- **Live company contract snapshots** copy plan features/period/currency. Editing the catalog does not rewrite existing company contracts; an owner must explicitly reassign.
- Company accounts continue using the existing, transaction-safe `companies.account_limit` trigger. A plan assignment adjusts this limit inside the same transaction. A legacy direct account-limit override is rejected after a company has a subscription.
- Project creation blocked at the database layer when the company's subscribed project cap is reached; plan downgrade below used projects/seats is rejected. All cap mutations serialize on the company lock.
- Pending, unexpired invitations reserve seats. Accepting an invitation transfers the seat to the newly active member rather than double-counting it. Revocation/expiry releases the reservation. Ordinary seat usage displays active + reserved separately.
- Owner can set `trial`, `active`, `grace` or `suspended`. A suspended subscription blocks normal company-member service access, while verified platform-owner inspection remains available. There is **no automatic time-based state change** in this phase.
- Advanced sales/Deals reports check a subscribed `advanced_reports` flag server-side, and the company navigation hides those views when disabled. Existing non-subscribed companies continue their prior functionality. The negotiated price is visible only to authorized company management, never ordinary staff.
- All catalog and contract writes require Platform Owner authentication and same-origin request checks, plus version checks and audit-log entries.
- No sample pricing or plan rows were seeded. Existing companies were **not automatically assigned** a paid package.

## Explicit scope boundary
- Seat caps, project caps, suspended status, and advanced reporting access are **enforced**.
- Other feature flags shown in the catalog are provisioned as contract metadata but **not yet fully enforced in every functional endpoint** (such as WhatsApp, Buyer Matching, ERP and floorplan APIs). Do not sell those restrictions as production-grade until individual endpoint coverage tests are completed.
- No online payment collection, usage metering, prorated extra seat charges, automatic renewal, invoices, discounts, contract-change scheduler, tax handling or grace-expiry job yet. `agreed_price_minor` is informational and owner-managed, not a payment instruction.
- Lifecycle `ends_at` is a human-reviewed contract end; it does not auto-disable customer access.

## Verified on Neon DEV
- Migration 033 + 034 applied to the isolated DEV database (no plan/catalog row was left behind by QA).
- Transaction-rollback scenarios proved: downgrade blocked beneath live seats/projects; extra member/project rejected at limits; catalog feature edits did not rewrite a live subscription snapshot; tenant RLS prevents reading other company's subscriptions.
- Further rollback scenario proved: pending invite reserves an available seat; accepting does not double count; full company rejects another invite; deactivation, expiry and revoke free seats; downgrade recognizes still-reserved invitation seats.
- The exact SQL emitted by `assignSubscription` was compiled against Neon and executed inside a rollback-only transaction: new subscription at version 1; upgraded contract at version 2; company account cap synchronized. No sample contract persisted.
- CI runs navigation/date/CSV tests, TypeScript and production-compatible Cloudflare build on feature head before merge.

## Deferred acceptance
- Final login/browser tests with Platform Owner, Admin, Sales, manager, Operations and Finance; mobile RTL/LTR and dark/light.
- Full dedicated DEV fixture integration suite, export/audit checks, higher concurrency and dedicated deployment verification.
- Product pricing tiers and extra-seat/project unit prices require commercial approval; no invented prices are included.
