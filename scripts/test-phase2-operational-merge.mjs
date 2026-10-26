import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sql=read('db/068-contract-receipt-compatibility.sql');
const fx=read('lib/bunyra/decimal-installments.ts');
const commercial=read('lib/bunyra/commercial.ts');
const data=read('lib/bunyra/inventory.ts');
const viewer=read('app/FloorplanViewer.tsx');
const ui=read('app/inventory-client.tsx');
const api=read('app/api/bookings/confirmed/route.ts');
const live=read('app/api/commercial/route.ts');
const panel=read('app/inventory-panel.tsx');
for(const needed of [
 'collections_contract_installment_scope_fk',
 'REFERENCES contract_installments(company_id,contract_id,id)',
 'CREATE VIEW installments WITH (security_invoker=true)',
 'CREATE TABLE receipts',
 'CREATE TABLE receipt_cheque_events',
 'RECEIPT_APPEND_ONLY',
 'FORCE ROW LEVEL SECURITY',
 'TO bunyra_tenant',
 'bunyra_receipt_validate',
 'bunyra_cheque_event_validate',
 'bunyra_mirror_collection_receipt',
 'AFTER INSERT ON collections'
])assert(sql.includes(needed),'Missing financial migration invariant: '+needed);
assert(sql.includes("AS $mirror$") && sql.includes("END $mirror$;"),"Receipt trigger SQL requires a matching dollar quote");
assert(!sql.includes("AS $\\n")&&!sql.includes("END $;"),"Broken SQL dollar quote");
assert(sql.includes("linked.new_state='CLEARED'"),"Do not double-list mirrored cleared receipts");
assert(!sql.includes('CREATE TABLE contracts'),'Canonical contracts MUST NOT be duplicated');
assert(!sql.includes('CREATE TABLE contract_installments'),'Canonical installments MUST NOT be duplicated');
assert(!sql.includes('CREATE TABLE collections'),'Canonical collections MUST NOT be duplicated');
assert(fx.includes("from 'decimal.js'"),'Exact decimal dependency required');
assert(fx.includes('sum.eq(total)'),'Penny-accurate schedule sum required');
assert(commercial.includes('generateInstallmentsExact(calc)'),'Contract creation must use exact calculator');
assert(commercial.includes('SELECT id FROM bookings WHERE company_id=')&&
 commercial.includes(' FOR UPDATE'),'Contract flow must lock booked row');
assert(data.includes('u.status')&&data.includes('AS svg_coordinates'),'Inventory status and SVG must come from live SQL');
assert(data.includes('plan_layouts l')&&data.includes('l.published=true'),'Only published geometry can be exposed');
assert(viewer.includes('parseGeometry')&&!viewer.includes('fallbackShapes'),'Do not draw imaginary units');
assert(ui.includes("view:'bookings'")&&ui.includes("action:'book_unit'"),'Floorplan booking routes to existing authorized module');
assert(panel.includes('<InventoryClient '),'Inventory workspace must show floorplan');
assert(api.includes('createConfirmedBooking')&&api.includes('sameOrigin'),'Confirmed booking API must verify origin and identity');
assert(live.includes('identity()'),'Original commercial API must use BUNYRA sessions');
const cheques=read('lib/bunyra/cheques.ts'),chequeApi=read('app/api/treasury/cheques/route.ts'),chequeUi=read('app/cheque-panel.tsx');
assert(cheques.includes("await requireContract("),"Cheque actions must enforce contract and project access");
assert(cheques.includes("SELECT id FROM contracts")&&cheques.includes("FOR UPDATE"),"Cheque issue must lock contracts");
assert(cheques.includes("'PENDING'")&&cheques.includes("'BOUNCED'"),"Issue and bounce flow must be present");
assert(commercial.includes("cheque_receipt_id")&&commercial.includes("receipt_cheque_events"),"Cheque clearing must link the collection atomically");
assert(chequeApi.includes("identity()")&&chequeApi.includes("sameOrigin(request)"),"Cheque API must use BUNYRA auth and origin protection");
assert(chequeUi.includes("operation:'clear'")&&chequeUi.includes("operation:'bounce'"),"UI must support real cheque resolution");
console.log('Phase 2 static guards passed: tenant-scoped ledgers, immutable receipts, Decimal.js, live SVG and booking workflow.');
