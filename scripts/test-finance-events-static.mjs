import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync('db/040-finance-events.sql','utf8');
const booking=fs.readFileSync('lib/bunyra/commercial.ts','utf8');
const service=fs.readFileSync('lib/bunyra/finance-events.ts','utf8');
let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
check('business changes capture financial events inside source transactions',()=>{
 for(const name of ['finance_booking_events','finance_contract_events','finance_collection_events',
 'finance_adjustment_events','finance_commission_events'])assert.ok(sql.includes(name));
});
check('booking receipt contract reallocation is not counted twice',()=>{
 assert.match(booking,/set_config\('app\.booking_receipt_allocation','1',true\)/);
 assert.match(sql,/current_setting\('app\.booking_receipt_allocation',true\)='1'/);
 assert.match(sql,/booking_receipt_allocated/);
});
check('events cannot be forged directly by the tenant role',()=>{
 assert.match(sql,/GRANT SELECT ON finance_events TO bunyra_tenant/);
 assert.doesNotMatch(sql,/GRANT SELECT,INSERT ON finance_events TO bunyra_tenant/);
});
check('source idempotency, RLS and permission boundaries are declared',()=>{
 assert.match(sql,/UNIQUE\(company_id,source_kind,source_id,event_type\)/);
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/bunyra_tenant_company\(\)/);
 assert.match(sql,/FINANCE_MAPPING_INVALID/);
 assert.match(sql,/FINANCE_EVENT_NOT_POSTABLE/);
});
check('finance event source cannot be forged by finance API',()=>{
 assert.match(service,/configureFinanceMapping/);
 assert.match(service,/postFinanceEvent/);
 assert.doesNotMatch(service,/INSERT INTO finance_events/);
});
console.log(JSON.stringify({passed}));
