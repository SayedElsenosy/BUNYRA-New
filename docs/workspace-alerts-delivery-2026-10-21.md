# In-app workspace alerts — BUNYRA New (21 Oct 2026)

## Implemented
- **New Alerts Center** in Company Workspace and an unread-count bell in the topbar. Arabic/English, RTL/LTR, light/dark mode and responsive styling use BUNYRA theme tokens.
- Existing **Workspace Hub task scopes** are reused in the backend, rather than duplicating sensitive joins: open CRM follow-ups assigned to the permitted salesperson/team; submitted booking approvals for authorized Operations; pending booking-receipt confirmations for allowed Finance; and active due/partial installments for authorized Finance/project scopes.
- Unread counts are derived from the **full scoped task set** before the 20-row pager or date/category filter.
- Read receipts are **per company + user + task identity**, constrained by PostgreSQL FORCE RLS and the same RLS-wrapped Neon connection. A user cannot mark another user’s or another company’s task as read, or acknowledge tasks they can no longer see.
- A task becomes unread again when its due time, title/context or urgency bucket changes. Completed work is not shown in the active inbox. Marking read never completes, cancels or reassigns a task.
- Additive schema migration `032-workspace-alerts`; no retroactive notifications, no customer email changes, no WhatsApp or push delivery. Default unread state for all newly visible work.
- Topbar and inbox refresh on open, window focus, manual refresh and (while active) every 60 seconds. The client never invents event counts.

## Concurrency / parallel work
- Open PR #12 already implements recurrence, postponements and escalated follow-up alerts; this batch **does not duplicate or overwrite it**.
- The alerts service imports the current authorized task CTE. If PR #12 modifies that CTE before merging, rerun CI and the read-scope tests after rebasing.

## Validation
- GitHub Actions checks: navigation role visibility, report/CSV tests, TypeScript and Cloudflare build on Linux.
- Neon **DEV** `dev-foundation`: migration 032 installed and exact composed task alert SQL queried successfully on existing synthetic Hub QA fixtures. A Sales test user saw three permitted follow-ups and no other role’s work.
- Under the `bunyra_tenant` role, inserting the user’s read receipt succeeds and attempting to insert a receipt for another user fails the row-level security policy. QA used an exception rollback block; post-check confirmed zero retained test read receipts.
- Isolated `scripts/test-workspace-alerts.mjs` added to the existing `test:workspace` DEV suite. It checks role-based queues, read-state persistence, personal RLS, reprioritization resets, foreign company denial and invalid payload rejection. **The complete fixture suite was not run in this session**; it requires an isolated DEV test connection and explicit fixtures flag.
- Interactive role-login browser verification is deliberately deferred to the user’s final testing round and has not been claimed.

## Before production acceptance
- Verify the full test:workspace suite on isolated DB.
- Check Sales, Manager, Operations, Finance, Company Admin and owner sessions manually in RTL/LTR and narrow mobile.
- Validate RLS under multiple concurrent users and poll load at the intended deployment scale.
- Distinguish this **in-app active-task inbox** from future durable notifications with retention, delivery retries and preference controls.
