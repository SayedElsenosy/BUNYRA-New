# CRM workspace, quarterly targets and notifications

This extends the existing lead workspace rather than replacing inventory, pricing, bookings, contracts or finance.

## Interface

- Engaz-style side sheets for customer profiles, action/interaction/follow-up forms and existing workspace editors. Customer URLs remain deep links. Closing a profile retains lead filters; nested editors are portalled above the profile and restore focus. New sheets support Escape and a focus loop.
- Insula-style dashboard composition, KPI cards, source/stage summaries, recent leads and team activity, with existing BUNYRA branding, Arabic/English and responsive layouts.
- A settings navigation column groups General, Team, quarterly targets, roles, overrides, routing, stages and organizational settings. It displays only authorized screens. Platform packages/quotas remain in the owner console; this does not add third-party hosting or backup controls to company accounts.
- Reports add actual lead conversion, stage counts, tracked stage age, sources, monthly cohort conversion and lead-to-contract velocity. Cohort conversion counts a lead once, only when a non-cancelled contract has an explicit booking.lead_id link, signed by period end. Contracts without such a link are excluded and labeled as such. Stage distribution is a current snapshot, not an invented historical funnel. Existing activity/commission reports and CSV remain.
- Arabic/English Lead, Pipeline and Team PDF exports use the same authenticated scopes. Lead/Pipeline exports use cohort filters (date/project/user); booking and contract status filters apply to Team/activity. Team PDF is capped at 1,000 grouped rows, CSV at 10,000. No source-cost/ROI values are invented in the absence of budget data.

## Quarterly sales targets

Apply `db/037-quarterly-sales-targets.sql` after 035/036 and existing main migrations. It adds a tenant-RLS table keyed by company, user and calendar quarter start (Jan/Apr/Jul/Oct 1).

- Money is stored and transferred as integer minor-unit strings. Currency is explicit; different currencies are never combined or converted.
- Creation is optional in the sales-account form. Account, membership, target and audit entries commit in one transaction. Existing accounts can be configured in Settings > Sales targets, independently for each quarter.
- Company accounts with effective `accounts.manage`, or a verified platform owner, can set a target for active sales/sales-manager/sales-admin memberships. Writes are version checked; concurrent/stale edits cannot overwrite a newer target.
- A salesperson sees their own target; sales managers follow the existing team scope. Read-only CRM users cannot gain account-management access. Custom permission denies and package gates are enforced by services, not just navigation.
- Achievement is the sum of `contracts.value_final_minor` for active/completed contracts, attributed to the immutable original sales-user snapshot, in the target currency and caller-permitted projects. Signing timestamps are bounded by company-local quarter boundaries. Offers, stage Won and unsigned reservations do not count. Cancelling a contract automatically removes its value; a cash refund alone does not rewrite gross signed sales.
- The gauge caps its needle at 100% but shows the actual rounded percentage above 100%. Amounts remain exact. It refreshes on commercial changes, focus and every minute while active.

## Notifications

The global workspace bell opens a compact dropdown (up to 8 of the latest 20 visible items), a personal unread badge, mark-all-read, record deep links, empty/error states and a link to the paginated notification center. Both UI surfaces request recent-first ordering; other inbox callers retain priority order by default.

Existing authoritative work-item scopes supply Fresh assignments, follow-ups, booking approvals, receipts and installments. Read receipts are personal and signature based; due-date/context changes can make an item unread again. Mark-all-read selects the current authorized items server-side in a single statement. It cannot mark a peer’s records or bypass tenant/project membership.

This is an active in-app inbox. Completed work leaves the inbox; audit history remains in its existing module. It does not send email, WhatsApp, browser push or external messages.

## Validation and rollout

`npm run test:crm-experience` requires an explicitly enabled isolated test database with the synthetic platform-owner guard. The checks cover target/account atomicity, money/currency, cancellation, company-local quarter boundaries, project/tenant/custom-role access, forged owner mode, plan gates, version races, actual conversion and personal bulk reads.

Development validation used the existing isolated Neon DEV branch. Production schema/data were not changed. Deployments must apply 035, 036 and 037 before serving this branch. No passwords, database URLs or private test runtime configuration belong in this repository.
