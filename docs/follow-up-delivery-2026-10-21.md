# Follow-ups, recurrence and response deadlines · 21 October 2026

## Delivered
A dedicated Follow-ups page provides full scoped counts, 20-row server paging, open/overdue/today/tomorrow/needs-attention/completed/cancelled filters, exact record links, and the latest 30 authorized history entries. Representatives see assigned work, managers their team, and company roles their allowed company records. Linked-project read and write permissions are enforced before counts, history or mutations. Read-only accounts have no action controls.

Postponement requires a future company-local date later than the current due date, the current record version and a reason. Cancellation and recurrence changes also require reasons. Every mutation locks the open occurrence, increments its version and atomically logs before/after data. Stale My Work actions cannot complete a postponed occurrence. Existing completion entry points share the same workflow.

Daily, weekly and monthly recurrence supports an interval of 1–12 periods. Completion creates exactly one next occurrence with the same customer, lead, assignee and recurrence settings; the predecessor reference is unique and company-scoped. Late completion starts the interval from completion instead of generating a missed backlog. Future completion starts from the existing due date. Dates follow company time; month ends clamp to the last available day, and PostgreSQL time-zone normalization applies to daylight-saving transitions. Nonexistent user-entered local dates are rejected. Disabling recurrence preserves the open occurrence; cancellation produces no successor. An inactive assignee blocks automatic successor creation.

Company Settings includes the overdue-hours threshold (1–720, default 24). Needs-attention alerts appear inside the authorized follow-up list and refresh every minute while its list is visible. This is an in-app escalation signal; it does not send email/WhatsApp, reassign an employee or claim delivery of a push notification. My Work's existing overdue reminders remain available. SLA rule builders, durable notification delivery and escalation assignment chains remain later work.

Customer profile scheduling now accepts company-local time and recurrence. Customer 360 and My Work links open the exact follow-up history, with a link back to the customer. Settings stay inside Settings; follow-up actions stay in Follow-ups. Business bookings, contracts and collections are unchanged.

## Validation
34 isolated DEV workflow checks include concurrent completion, version conflicts, reasoned postponement, cancellation, recurrence stop, month end, daylight saving, inactive assignee, own/team/project/tenant access, history, paging, unique successor and company retention compatibility.
111 existing workspace/boundary/customer-profile/CRM/sales/organization checks, 23 navigation checks and 6 HTTP auth/CSRF/method checks: 174 automated checks total. TypeScript passed.
Browser testing uses synthetic DEV data only. Production business records are not used for write tests.

## Release
Additive migration 030 is tested in DEV first. Existing occurrences default to no recurrence and retain their dates/status/assignees. Production migration, exact Linux build, merge and live endpoint evidence are retained in the delivery outputs.
