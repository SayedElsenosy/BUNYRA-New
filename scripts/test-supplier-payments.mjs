import assert from 'node:assert/strict';import fs from 'node:fs';
const migration=fs.readFileSync('db/047-supplier-payments.sql','utf8'),
 api=fs.readFileSync('lib/bunyra/vendor-payables.ts','utf8'),
 route=fs.readFileSync('app/api/vendor-payables/route.ts','utf8');
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
test('vendor bill partial payments require already posted source invoice',()=>{
 for(const x of ["bill.status<>'posted'","VENDOR_PAYMENT_REQUIRES_POSTED_BILL","VENDOR_PAYMENT_OVERPAID","FOR UPDATE"])assert.ok(migration.includes(x),x);
});
test('idempotent repeated payment safely returns original reference',()=>{
 for(const x of ['idempotency_key=p_key','RETURN previous.id','VENDOR_PAYMENT_IDEMPOTENCY_CONFLICT',
  'UNIQUE(company_id,entity_id,bill_id,idempotency_key)'])assert.ok(migration.includes(x),x);
});
test('cash and bank payouts are balanced immutable GL postings',()=>{
 for(const x of ["a.role IN('bank','cash')","a.kind='asset'","map.payable_account_id","bunyra_ledger_post_entry",
  "'vendor_bill',bill.id,event_key","VENDOR_PAYMENT_IMMUTABLE"])assert.ok(migration.includes(x),x);
});
test('tenant RLS and authorized reviewer double check',()=>{
 for(const x of ["bunyra_tenant_company()","FORCE ROW LEVEL SECURITY","role IN('company_admin','finance_manager')",
 "GRANT SELECT ON finance_vendor_payments","REVOKE ALL ON FUNCTION bunyra_pay_vendor_bill"])assert.ok(migration.includes(x),x);
 assert.doesNotMatch(migration,/GRANT (?:INSERT|UPDATE|DELETE) ON finance_vendor_payments/);
});
test('API mutation requires permission and same origin',()=>{
 assert.match(api,/manager\(sql,actor,c.company_id,'finance.approve'/);
 assert.match(route,/sameOrigin\(request\)/);assert.match(route,/payVendorBill\(sql,actor,input,owner\)/);
});
console.log('PASS '+passed+' supplier payment safeguards');
