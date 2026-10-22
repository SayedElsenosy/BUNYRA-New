import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const raw=neon(process.env.BUNYRA_TEST_DATABASE_URL);
if(!(await raw`SELECT version FROM schema_migrations WHERE version='041-vendor-payables'`).length)
 throw Error('Run reviewed migration 041 on isolated Neon dev-foundation before integration tests');
const [{tenantSql},ledger,vendors]=await Promise.all([
 import('../.sites-runtime/tests/tenant.mjs'),
 import('../.sites-runtime/tests/ledger.mjs'),
 import('../.sites-runtime/tests/vendor-payables.mjs')
]);
const actor={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
const company=crypto.randomUUID(),part=company.slice(0,8),fresh=()=>tenantSql(raw);
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name)};
const deny=(fn,code)=>assert.rejects(fn,e=>e.code===code||e.message===code);
await raw`INSERT INTO companies(id,name) VALUES(${company},${'Supplier Tests '+part})`;
const entity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${company} AND is_default`)[0].id;
let payable,expense,journal,vendor,bill;
await check('create chart accounts and purchase journal for a legal entity',async()=>{
 payable=(await ledger.ledgerCreateAccount(fresh(),actor,{company_id:company,entity_id:entity,code:'2100',name:'Trade suppliers',kind:'liability',role:'payable'},true)).account;
 expense=(await ledger.ledgerCreateAccount(fresh(),actor,{company_id:company,entity_id:entity,code:'5300',name:'Project services',kind:'expense'},true)).account;
 journal=(await ledger.ledgerCreateJournal(fresh(),actor,{company_id:company,entity_id:entity,code:'PURCH',name:'Purchase journal',kind:'purchase'},true)).journal;
 await vendors.configurePayableMapping(fresh(),actor,{company_id:company,entity_id:entity,journal_id:journal.id,payable_account_id:payable.id},true);
});
await check('one vendor and a balanced supplier bill without tax',async()=>{
 vendor=(await vendors.createFinanceVendor(fresh(),actor,{company_id:company,code:'VN-001',name:'Test contractor'},true)).vendor;
 const created=await vendors.createVendorBill(fresh(),actor,{
  company_id:company,entity_id:entity,vendor_id:vendor.id,invoice_number:'BILL-001',
  invoice_date:'2026-10-22',due_date:'2026-11-22',
  lines:[{expense_account_id:expense.id,description:'Consulting',amount_minor:'10000'},
         {expense_account_id:expense.id,description:'Survey services',amount_minor:'25000'}]
 },true);
 bill=created.bill;
 assert.equal(created.line_count,2);assert.equal(bill.total_minor,'35000');
 const view=await vendors.vendorPayablesOverview(fresh(),actor,company,true);
 assert.ok(view.vendors.some(x=>x.id===vendor.id));assert.ok(view.bills.some(x=>x.id===bill.id));
});
await check('cannot post a draft before finance approval',async()=>{
 await deny(()=>vendors.postVendorBill(fresh(),actor,{company_id:company,bill_id:bill.id},true),'VENDOR_BILL_NOT_APPROVED');
});
await check('approval and protected posting create four balanced lines',async()=>{
 await vendors.approveVendorBill(fresh(),actor,{company_id:company,bill_id:bill.id},true);
 const posted=await vendors.postVendorBill(fresh(),actor,{company_id:company,bill_id:bill.id},true);
 const x=(await raw`SELECT state FROM ledger_entries WHERE id=${posted.entry_id}`)[0];
 assert.equal(x.state,'posted');
 const amounts=(await raw`SELECT count(*)::int n,sum(debit_minor)::text d,sum(credit_minor)::text c,
  count(*) FILTER(WHERE vendor_id=${vendor.id}::uuid)::int vendor_lines
  FROM ledger_lines WHERE entry_id=${posted.entry_id}`)[0];
 assert.equal(amounts.n,4);assert.equal(amounts.d,'35000');assert.equal(amounts.c,'35000');
 assert.equal(amounts.vendor_lines,4);
});
await check('retry posting is idempotent and produces one audit event',async()=>{
 const again=await vendors.postVendorBill(fresh(),actor,{company_id:company,bill_id:bill.id},true);
 assert.ok(again.entry_id);
 const audit=(await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${company}
  AND action='finance.vendor_bill_posted'`)[0];
 assert.equal(audit.n,1);
});
await check('posted bills and lines are immutable',async()=>{
 await assert.rejects(()=>raw`UPDATE finance_vendor_bill_lines SET amount_minor=amount_minor+1
  WHERE company_id=${company} AND bill_id=${bill.id}`,e=>e.message.includes('VENDOR_BILL_IMMUTABLE'));
});
await check('a salesperson cannot read or create supplier payables',async()=>{
 const other={userId:'ap-seller-'+part,email:'ap-seller-'+part+'@example.test'};
 await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${other.userId},${other.email},'sales')`;
 await deny(()=>vendors.vendorPayablesOverview(fresh(),other,company),'FORBIDDEN');
 await deny(()=>vendors.createFinanceVendor(fresh(),other,{company_id:company,code:'VN-002',name:'Forbidden supplier'}),'FORBIDDEN');
});
console.log(JSON.stringify({passed:checks.length,checks,fixture_company:company},null,2));
