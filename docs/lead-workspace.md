# Lead workspace and operational stages

The lead directory uses a table with stage filters, source/agent/project filters, next-action dates and stage duration. The contact profile separates contact information and activity history from quick actions and the upcoming reminder. Existing buyer requests, offers, bookings and finance links remain in the customer journey.

## Database and rollout

Run migrations `035-lead-stages.sql` and `036-fresh-lead-alerts.sql` before deploying the application. They add operational `stage_code` and `stage_changed_at`, an action-managed reminder flag, and a new allowed notification receipt kind. They do not create business customers or modify financial records. Existing stage start times remain unknown until the first tracked action; historical durations are not fabricated.

The detailed stage list comes from `lib/bunyra/lead-stages.ts`. A database trigger maps it to the existing seven CRM statuses, preserving downstream sales reports. Status changes made through older workflows update the operational stage too. The existing company-configured Kanban stage IDs are retained.

## Actions and reminders

`POST /api/crm`, operation `lead_action`, validates the actor's tenant, salesperson and project scopes. An optimistic lead version prevents duplicate or stale actions. One database statement updates the stage, records the contact outcome, replaces only prior action-managed reminders, creates the next reminder and writes the audit entry. Independently scheduled tasks remain untouched.

Active stages require a future company-local date. Terminal stages allow no next date. Hour presets represent elapsed time; tomorrow/week presets preserve company wall-clock time across DST. A stage change restarts the stage clock; another outcome within the same stage does not.

Fresh leads are generated as scoped alerts until acted on. Reminder dates flow through the existing notification inbox and its overdue/today buckets, personal read receipts and polling. No customer message is sent by recording an action. Changing to Reservation or Done deal does not create a unit booking or a contract.

## Verification

`npm run typecheck`

`npm run test:lead-actions` with `BUNYRA_TEST_DATABASE_URL` and `BUNYRA_ALLOW_TEST_FIXTURES=1`; the test also refuses a database with a real platform owner. Coverage includes all stages, atomic action writes, stale/concurrent requests, timezone presets, scope isolation, reminder replacement, stage clocks and fresh-assignment read receipts. Test fixtures are for an isolated development database only.
