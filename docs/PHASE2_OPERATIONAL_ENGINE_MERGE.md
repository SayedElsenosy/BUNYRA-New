# Phase 2 of operational engine merge (068+)

## No duplicate accounting records

BUNYRA-New already has canonical `contracts`, `contract_installments` and `collections` with accounting postings, approved pricing snapshots and commissions. Creating replacement tables with the same names would destroy the integration. Migration `068-contract-receipt-compatibility.sql` instead strengthens those records:
- `collections(company_id,contract_id,installment_id)` references the exact `contract_installments(company_id,contract_id,id)`; this closes cross-contract allocations even inside one company.
- `installments` is a security-invoker SELECT view over `contract_installments`, not a competing writable table. Existing RLS on the underlying table remains effective.
- `receipts` stores immutable presentation/instrument metadata scoped by composite keys; it never adds its amount to balances.
- `receipt_cheque_events` is append-only and links PENDING cheque metadata to the existing collection only when cleared. A bounced event requires a reason. A CLEARED event must match an actual settled collection (same company, contract, installment and amount). One terminal event per cheque.
- A trigger mirrors every **new** `collections` row to one CLEARED receipt in the SAME transaction. Payment methods are inferred from actual company payment account kind, or marked UNSPECIFIED if unavailable. Old collection rows aren't backfilled to avoid incorrectly labeling historical payments.
- All new tables use bunyra_tenant, FORCE RLS, `bunyra_tenant_company()`, and no runtime UPDATE/DELETE/TRUNCATE. Legacy `tenant_id` isn't used in BUNYRA.
- Ledger entries, finance events and posting hooks remain in charge of the money. Do not treat pending cheques as cleared collections.

## Decimal accuracy

`generateInstallmentsExact` uses Decimal.js 10.6.0 (included in package.json + lock), verifies nonnegative integer minor amounts and checks that the entire schedule sums exactly to approved contract value. It is called from `createContract`, which persists the existing approved price book schedule with `company_id` in the tenant-scoped transaction. It never changes the amount approved by pricing and never converts money to JS floating-point.

## Floorplan

`app/FloorplanViewer.tsx` safely renders only numeric polygons, not untrusted SVG source. The inventory SQL returns live `inventory_units.status`, scoped published `plan_unit_shapes` geometry, or an existing reviewed `units.svg_coordinates` extension; no mocked geometry. `app/inventory-client.tsx` opens BUNYRA's existing booking flow and preselects unit and project via URL navigation. The commercial API verifies `getCurrentUser` (managed session or Neon Auth), active membership, project permissions, approved price and unit locks on server. The workspace inventory panel exposes table/plan switching, requiring building + floor filters to avoid overlaying unrelated plans. `/inventory` redirects into the established company workspace.

The additional `POST /api/bookings/confirmed` is company-admin-only via the existing `createConfirmedBooking` backend; ordinary sales must use submitted -> operations approved -> accounts confirmation via `/api/commercial`.

## Rollout/test gate

The BUNYRA Neon project earlier returned **branches limit exceeded** when creating a dedicated rehearsal branch. **Neither 067 nor 068 is applied to production in this change.**
Build/static CI validates syntax, types and authorization wiring. Running the existing commercial integrity tests on an *approved isolated fixture branch that has both 067 and 068* is required before any real data migration. Full browser E2E for the transferred floorplan, booking, contract and collection must also be completed there; do not claim production E2E without a safe migration and accounts.

For deploying, apply migrations in sequence `067` then `068`, not `068` alone. Inspect possible existing collection/installment mismatches before applying the new FK:
```sql
SELECT count(*) FROM collections c
LEFT JOIN contract_installments i
 ON i.company_id=c.company_id AND i.contract_id=c.contract_id AND i.id=c.installment_id
WHERE i.id IS NULL;
```
A nonzero result must be reconciled; do not suppress the FK.
