# BUNYRA — Customer 360 delivery · 21 October 2026

## Delivered
- A focused customer profile with separate Activity, Leads, Follow-ups, Buyer Requests, Bookings/Units, Contracts and Receipts tabs. Financial tabs require their existing permissions.
- SQL scoping by company, project and salesperson/team before counts or 20-row pagination. Custom roles and explicit denials stay authoritative. Sales Admin financial results remain restricted to their own sales.
- Customer identity is reused across bookings and contracts. The contact directory retains its existing company-sharing policy; related activities and commercial records do not inherit unrestricted access from that directory.
- Call, WhatsApp and email links open the contact application. They do not create an activity. Logged calls, meetings and notes use explicit audited CRM writes. No external message is sent by this delivery.
- A new buyer request opens with the original customer selected, including exact customer lookup before the legacy list limit. Saving opens the same request and its approved-price matching results. The request links back to the same customer.
- Exact request and booking/contract/receipt links recheck scope. Returning to a visited profile refreshes its data. Dates show the company's time zone.
- Profile sections avoid a stacked page; timeline has bounded scrolling. Keyboard tab navigation, focused CRM dialogs, loading/error/empty states, Arabic/English and mobile layout.
- Existing CRM response now excludes unrelated colleagues' null-lead activities. Owner selection defaults to the current employee rather than the first membership.

## Validation
- 30 existing workspace integration checks on a fresh synthetic DEV fixture.
- 29 customer journey checks: own/team/company/project boundaries, financial denial, frozen contract value/currency, full counts/paging, existing CRM scope, exact customer/request lookup, explicit activity audit, read-only fetching and tenant binding.
- 8 existing CRM regression checks.
- 20 navigation permission checks.
- 2 HTTP checks: unauthenticated GET 401 and write method 405 on the read-only profile endpoint.
- Browser: Sales test account, direct profile URL, call logging, preselected customer/new request/save/matches/return, keyboard tabs. Mobile: 390px viewport, no horizontal overflow. Browser also verified that a customer outside the first 500 remains selected after directory refresh (500 directory contacts plus the exact pinned customer). Deployed checks recorded after verification.
- No production schema migration, financial test transaction, account change, secret change or plan mapping.

## Remaining PDF work
BN015, BN021 and BN029 are still partial: persisted offer history and original document retrieval, customer attachments, contextual comparison→offer→booking handoff, a dedicated meeting/calendar model and the remaining journey E2E coverage are not completed here. Existing offers remain on-demand PDFs. Kanban drag/drop and SLA/recurring follow-ups are subsequent work. This delivery does not mark all 59 requirements complete.
