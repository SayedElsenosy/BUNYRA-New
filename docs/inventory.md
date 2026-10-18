# Inventory management

Migration 005 adds normalized project-scoped inventory and status history. Codes are unique within a project, ignoring letter case. Area and proposed price use exact decimal input and integer minor units. Units have administrative activation and availability, optimistic versions, and atomic before/after audit snapshots. Inventory writes require inventory.write AND a Company Admin or Operations role (or explicit Platform Owner access). Project permission denials still win. Sales receive status/area records without draft prices.

The API accepts only available/unavailable administrative transitions. Pending/reserved/sold are displayable but cannot be assigned by the inventory editor. Existing committed records are protected both by service filtering and a database trigger. Future booking/contract modules must introduce a controlled transition function and update that guard in their own migration; they must not use this administrative editor.

Inventory records are independent from setup drafts: editing a draft never changes operational units. Building/floor/category labels are stored as unit metadata; the interactive map/publication module is not implemented here. Draft unit rows are not automatically imported. No production test units or prices are seeded.

List filters use literal search (not wildcard SQL), project scope, building, floor and status, with 100 rows per page. Status history returns the latest 100 transitions for the selected unit. There are no deletion endpoints.

Approved price lists, unit-specific allowed payment plans, discounts and sale eligibility checks remain the next pricing/booking modules. Proposed prices in this release are internal drafts and are never presented as approved to Sales.
