import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const raw=neon(process.env.BUNYRA_TEST_DATABASE_URL);
const [{tenantSql,bindTenant},ledger,ap,bank,paymentAccounts,controls]=await Promise.all([
 import('../.sites-runtime/tests/tenant.mjs'),import('../.sites-runtime/tests/ledger.mjs'),import('../.sites-runtime/tests/vendor-payables.mjs'),
 import('../.sites-runtime/tests/treasury.mjs'),import('../.sites-runtime/tests/payment-accounts.mjs'),import('../.sites-runtime/tests/ledger-controls.mjs')
]);
const owner={userId:'identity-test-platform-owner',email:'platform-test@example.com'},company=crypto.randomUUID(),part=company.slice(0,8);
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);},fresh=()=>tenantSql(raw);
await raw`INSERT INTO companies(id,name) VALUES(${company},${'Supplier credits DEV '+part})`;
console.log('DEV supplier-credit fixture '+company);
try{
 const entity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${company}`)[0].id;
 await ledger.initializeAccounting(fresh(),owner,{company_id:company,entity_id:entity,language:'en'},true);
 const gl=await ledger.ledgerOverview(fresh(),owner,company,true),expense=gl.accounts.find(a=>a.code==='5110'),payable=gl.accounts.find(a=>a.role==='payable');
 const projects=[crypto.randomUUID(),crypto.randomUUID()];
 await raw`INSERT INTO projects(id,company_id,name) VALUES(${projects[0]},${company},'Project one'),(${projects[1]},${company},'Project two')`;
 const center=(await ledger.ledgerCreateCostCenter(fresh(),owner,{company_id:company,entity_id:entity,project_id:projects[1],code:'COST2',name:'Project two center'},true)).center;
 const vendor=(await ap.createFinanceVendor(fresh(),owner,{company_id:company,code:'V01',name:'Credit and refund test vendor'},true)).vendor;
 const createAccount=(code,currency)=>paymentAccounts.createPaymentAccount(fresh(),owner,{company_id:company,entity_id:entity,code,name:'Bank '+code,kind:'bank',currency_code:currency},true);
 const account1=(await createAccount('LOCAL1','EGP')).id,account2=(await createAccount('LOCAL2','EGP')).id,foreign=(await createAccount('DOLLAR','USD')).id;
 const accounts=(await bank.treasuryOverview(fresh(),owner,company,true)).payment_accounts,first=accounts.find(a=>a.id===account1);
 const createBill=async(ref)=>{const bill=(await ap.createVendorBill(fresh(),owner,{company_id:company,entity_id:entity,vendor_id:vendor.id,invoice_number:ref,invoice_date:'2026-01-01',due_date:'2026-01-31',
   lines:[{expense_account_id:expense.id,project_id:projects[0],description:'Services one',amount_minor:'6000'},{expense_account_id:expense.id,project_id:projects[1],cost_center_id:center.id,description:'Services two',amount_minor:'4000'}]},true)).bill;
  await ap.approveVendorBill(fresh(),owner,{company_id:company,bill_id:bill.id},true);await ap.postVendorBill(fresh(),owner,{company_id:company,bill_id:bill.id},true);
  const lines=(await ap.vendorCreditBillLines(fresh(),owner,company,bill.id,true)).lines;return {...bill,lines};};
 const bill=await createBill('CREDIT-A-'+part);
 const credit=(b,ref,lines,date='2026-01-03',key='credit-'+ref)=>ap.postVendorCredit(fresh(),owner,{company_id:company,bill_id:b.id,reference:ref,credit_date:date,reason:'Supplier approved price credit',idempotency_key:key,lines},true);
 const pay=(b,amount,key,date='2026-01-04')=>ap.payVendorBill(fresh(),owner,{company_id:company,bill_id:b.id,journal_id:first.journal_id,cash_account_id:first.account_id,paid_on:date,amount_minor:amount,idempotency_key:key},true);
 const refund=(id,amount,key,account=account1,date='2026-01-06',reference=key)=>ap.receiveVendorRefund(fresh(),owner,{company_id:company,credit_id:id,payment_account_id:account,received_on:date,amount_minor:amount,reference,idempotency_key:key},true);
 let partial,full,payment,received;
 await check('partial line credit is idempotent and reduces outstanding without inventing cash',async()=>{
  const input=[{bill_line_id:bill.lines[0].id,amount_minor:'2000'}];const r=await Promise.all([credit(bill,'PARTIAL-A',input),credit(bill,'PARTIAL-A',input)]);assert.equal(r[0].credit_id,r[1].credit_id);partial=r[0].credit_id;
  const b=(await ap.vendorPayablesOverview(fresh(),owner,company,true)).bills.find(b=>b.id===bill.id);
  assert.equal(b.credited_minor,'2000');assert.equal(b.net_total_minor,'8000');assert.equal(b.remaining_minor,'8000');assert.equal(b.refundable_minor,'0');
  assert.equal((await raw`SELECT count(*)::int n FROM finance_vendor_refunds WHERE company_id=${company}`)[0].n,0);
 });
 await check('unpaid credits cannot generate a supplier cash refund',async()=>{
  await assert.rejects(()=>refund(partial,'1','no-cash-due'),e=>e.message==='VENDOR_REFUND_EXCEEDS_CREDIT');
 });
 await check('changed retries, duplicate lines and foreign line IDs are rejected atomically',async()=>{
  await assert.rejects(()=>credit(bill,'PARTIAL-A',[{bill_line_id:bill.lines[0].id,amount_minor:'2001'}]),e=>e.message==='VENDOR_CREDIT_CONFLICT');
  await assert.rejects(()=>credit(bill,'DUP-LINE',[{bill_line_id:bill.lines[0].id,amount_minor:'1'},{bill_line_id:bill.lines[0].id,amount_minor:'1'}]),e=>e.message==='VENDOR_CREDIT_LINES_INVALID');
  await assert.rejects(()=>credit(bill,'FOREIGN-LINE',[{bill_line_id:crypto.randomUUID(),amount_minor:'1'}]),e=>e.message==='VENDOR_CREDIT_LINES_INVALID');
  await assert.rejects(()=>credit(bill,'OVER-LINE',[{bill_line_id:bill.lines[0].id,amount_minor:'4001'}]),e=>e.message==='VENDOR_CREDIT_EXCEEDS_LINE');
  await assert.rejects(()=>credit(bill,'EARLY',[{bill_line_id:bill.lines[0].id,amount_minor:'1'}],'2025-12-31'),e=>e.message==='VENDOR_CREDIT_BEFORE_BILL');
  assert.equal((await raw`SELECT count(*)::int n FROM finance_vendor_credits WHERE company_id=${company}`)[0].n,1);
 });
 await check('payment capacity respects credits and cannot overpay the adjusted invoice',async()=>{
  await assert.rejects(()=>pay(bill,'8001','over-net-bill'),e=>e.message==='VENDOR_PAYMENT_OVERPAID');
  payment=(await pay(bill,'8000','pay-adjusted-bill')).payment_id;
 });
 await check('full remaining line credits create an exact supplier receivable',async()=>{
  const remaining=(await ap.vendorCreditBillLines(fresh(),owner,company,bill.id,true)).lines;
  full=(await credit(bill,'FULL-A',remaining.map(l=>({bill_line_id:l.id,amount_minor:l.remaining_minor})),'2026-01-05')).credit_id;
  const b=(await ap.vendorPayablesOverview(fresh(),owner,company,true)).bills.find(b=>b.id===bill.id);assert.equal(b.net_total_minor,'0');assert.equal(b.remaining_minor,'0');assert.equal(b.refundable_minor,'8000');
  await assert.rejects(()=>credit(bill,'TOO-MUCH',[{bill_line_id:bill.lines[1].id,amount_minor:'1'}]),e=>e.message==='VENDOR_CREDIT_EXCEEDS_LINE');
 });
 await check('credit entries preserve original account, project, cost center and supplier dimensions',async()=>{
  const rows=await raw`SELECT l.project_id,l.cost_center_id,l.account_id,l.vendor_id,l.credit_minor::text amount FROM finance_vendor_credits c JOIN ledger_lines l ON l.entry_id=c.posted_entry_id WHERE c.id=${full} AND l.credit_minor>0 ORDER BY l.line_number`;
  assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.amount),['4000','4000']);assert.equal(rows[0].project_id,projects[0]);assert.equal(rows[1].project_id,projects[1]);assert.equal(rows[1].cost_center_id,center.id);assert.ok(rows.every(r=>r.account_id===expense.id&&r.vendor_id===vendor.id));
 });
 await check('foreign receiving account and dates before the credit are refused',async()=>{
  await assert.rejects(()=>refund(full,'100','wrong-currency',foreign),e=>e.message==='VENDOR_REFUND_ACCOUNT_INVALID');
  await assert.rejects(()=>refund(full,'100','before-credit',account1,'2026-01-04'),e=>e.message==='VENDOR_REFUND_BEFORE_CREDIT');
 });
 await check('concurrent identical refund requests post exactly one bank receipt and audit',async()=>{
  const r=await Promise.all([refund(full,'3000','refund-partial'),refund(full,'3000','refund-partial')]);assert.equal(r[0].refund_id,r[1].refund_id);received=r[0].refund_id;
  assert.equal((await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${company} AND action='finance.vendor_refund_received'`)[0].n,1);
  await assert.rejects(()=>refund(full,'3001','refund-partial'),e=>e.message==='VENDOR_REFUND_CONFLICT');
 });
 await check('a payment cannot be reversed after its cash has already been refunded',async()=>{
  await assert.rejects(()=>ap.reverseVendorPayment(fresh(),owner,{company_id:company,payment_id:payment,reversed_on:'2026-01-07',reason:'Would count returned cash twice'},true),e=>e.message==='VENDOR_PAYMENT_REFUND_CONFLICT');
 });
 await controls.lockLedgerPeriod(fresh(),owner,{company_id:company,entity_id:entity,from:'2026-01-08',to:'2026-01-08',reason:'Closed credit and refund period'},true);
 await check('closed-period refunds leave no partial document, journal or consumed budget',async()=>{
  await assert.rejects(()=>refund(full,'5000','closed-refund',account2,'2026-01-08'),e=>e.message==='LEDGER_PERIOD_LOCKED');
  assert.equal((await raw`SELECT count(*)::int n FROM finance_vendor_refunds WHERE company_id=${company}`)[0].n,1);
  assert.equal((await raw`SELECT count(*)::int n FROM ledger_entries WHERE company_id=${company} AND reference='AP-REFUND:closed-refund'`)[0].n,0);
 });
 await check('competing refunds cannot exceed the remaining actual receivable',async()=>{
  const r=await Promise.allSettled([refund(full,'5000','race-return-1',account2,'2026-01-09'),refund(full,'5000','race-return-2',account2,'2026-01-09')]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.message,'VENDOR_REFUND_EXCEEDS_CREDIT');
  const view=await ap.vendorPayablesOverview(fresh(),owner,company,true),b=view.bills.find(b=>b.id===bill.id);assert.equal(b.paid_minor,'0');assert.equal(b.refundable_minor,'0');assert.equal(b.remaining_minor,'0');
  assert.equal(view.refunds.length,2);assert.ok(view.refunds.some(r=>r.payment_account_id===account2));
 });
 await check('original expense and supplier balances reconcile after full credit and cash refund',async()=>{
  const totals=await raw`SELECT a.role,sum(l.debit_minor-l.credit_minor)::text amount FROM ledger_lines l JOIN ledger_entries e ON e.id=l.entry_id JOIN ledger_accounts a ON a.id=l.account_id WHERE l.company_id=${company} AND l.vendor_id=${vendor.id} AND e.state='posted' GROUP BY a.role`;
  assert.ok(totals.every(r=>r.amount==='0'));
 });
 await check('received supplier refund is available for exact native bank matching',async()=>{
  const [r]=await raw`SELECT posted_entry_id FROM finance_vendor_refunds WHERE id=${received}`;
  const [l]=await raw`SELECT id FROM ledger_lines WHERE entry_id=${r.posted_entry_id} AND account_id=${first.account_id}`;
  const stmt=(await bank.createBankStatement(fresh(),owner,{company_id:company,entity_id:entity,bank_account_id:first.account_id,statement_ref:'REFUND-BANK',date_from:'2026-01-01',date_to:'2026-01-31',opening_minor:'0',closing_minor:'3000'},true)).statement;
  const line=(await bank.importBankLines(fresh(),owner,{company_id:company,statement_id:stmt.id,lines:[{external_ref:'REFUND-PROOF',booked_on:'2026-01-06',signed_minor:'3000'}]},true)).imported[0];
  await bank.reconcileBankLine(fresh(),owner,{company_id:company,bank_line_id:line.id,ledger_line_id:l.id},true);await bank.closeBankStatement(fresh(),owner,{company_id:company,statement_id:stmt.id},true);
 });
 const later=await createBill('DATED-B-'+part);await pay(later,'10000','future-dated-original','2026-01-10');
 const laterCredit=(await credit(later,'BACKDATED-CREDIT',later.lines.map(l=>({bill_line_id:l.id,amount_minor:l.amount_minor})),'2026-01-03')).credit_id;
 await check('backdated refunds cannot borrow capacity from later payments',async()=>{
  await assert.rejects(()=>refund(laterCredit,'100','before-actual-payment',account1,'2026-01-04'),e=>e.message==='VENDOR_REFUND_EXCEEDS_CREDIT');
 });
 const mappingBill=await createBill('MAPPING-C-'+part),newAP=(await ledger.ledgerCreateAccount(fresh(),owner,{company_id:company,entity_id:entity,code:'2130',name:'Changed payable account',kind:'liability',role:'payable'},true)).account;
 await check('credit uses the original invoice control account after mapping changes',async()=>{
  await ap.configurePayableMapping(fresh(),owner,{company_id:company,entity_id:entity,journal_id:gl.journals.find(j=>j.kind==='purchase').id,payable_account_id:newAP.id},true);
  const c=(await credit(mappingBill,'ORIGINAL-CONTROL',[{bill_line_id:mappingBill.lines[0].id,amount_minor:'1000'}])).credit_id;
  const [line]=await raw`SELECT l.account_id FROM finance_vendor_credits c JOIN ledger_lines l ON l.entry_id=c.posted_entry_id WHERE c.id=${c} AND l.debit_minor>0`;
  assert.equal(line.account_id,payable.id);
 });
 await check('closed-period credits do not alter invoice line availability',async()=>{
  await assert.rejects(()=>credit(mappingBill,'CLOSED-CREDIT',[{bill_line_id:mappingBill.lines[0].id,amount_minor:'100'}],'2026-01-08'),e=>e.message==='LEDGER_PERIOD_LOCKED');
  const lines=(await ap.vendorCreditBillLines(fresh(),owner,company,mappingBill.id,true)).lines;assert.equal(lines[0].remaining_minor,'5000');
 });
 await check('competing credit notes cannot consume the same remaining invoice line twice',async()=>{
  const line=[{bill_line_id:mappingBill.lines[0].id,amount_minor:'5000'}];
  const r=await Promise.allSettled([credit(mappingBill,'RACE-CREDIT-1',line,'2026-01-12'),credit(mappingBill,'RACE-CREDIT-2',line,'2026-01-12')]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.message,'VENDOR_CREDIT_EXCEEDS_LINE');
 });
 await check('a duplicate received bank reference rolls back its extra journal and receipt',async()=>{
  await refund(laterCredit,'100','bank-proof-original',account1,'2026-01-12','BANK-SAME-PROOF');
  await assert.rejects(()=>refund(laterCredit,'100','bank-proof-duplicate',account1,'2026-01-12','BANK-SAME-PROOF'),e=>e.code==='23505');
  assert.equal((await raw`SELECT count(*)::int n FROM finance_vendor_refunds WHERE company_id=${company} AND reference='BANK-SAME-PROOF'`)[0].n,1);
  assert.equal((await raw`SELECT count(*)::int n FROM ledger_entries WHERE company_id=${company} AND reference='AP-REFUND:BANK-SAME-PROOF'`)[0].n,1);
 });
 await check('new documents and their source allocations are immutable',async()=>{
  for(const table of ['finance_vendor_credits','finance_vendor_credit_lines','finance_vendor_refunds'])await assert.rejects(()=>raw.query(`DELETE FROM ${table} WHERE company_id=$1`,[company]),e=>e.message==='VENDOR_CREDIT_IMMUTABLE');
 });
 await check('role overrides, direct function calls, tenant RLS and invoker view are protected',async()=>{
  const actor={userId:'credit-denied-'+part,email:'denied@example.test'};
  await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${actor.userId},${actor.email},'finance_manager')`;
  await raw`INSERT INTO member_permissions(company_id,user_id,action,allowed) VALUES(${company},${actor.userId},'finance.approve',false)`;
  await assert.rejects(()=>ap.postVendorCredit(fresh(),actor,{company_id:company,bill_id:mappingBill.id,reference:'DENIED',credit_date:'2026-01-12',reason:'Forbidden attempt',idempotency_key:'denied-credit-key',lines:[{bill_line_id:mappingBill.lines[0].id,amount_minor:'1'}]}),e=>e.code==='FORBIDDEN');
  const direct=fresh();bindTenant(direct,company,actor.userId);await assert.rejects(()=>direct`SELECT bunyra_receive_vendor_refund(${company}::uuid,${laterCredit}::uuid,${account1}::uuid,'2026-01-12',1,'Direct attempt','direct-denied-key')`,e=>e.code==='42501');
  const foreignScope=fresh();bindTenant(foreignScope,company,'not-a-company-member');
  for(const table of ['finance_vendor_credits','finance_vendor_credit_lines','finance_vendor_refunds','finance_vendor_bill_balances'])assert.equal((await foreignScope.query(`SELECT * FROM ${table} WHERE company_id=$1`,[company])).length,0);
 });
}finally{await raw`UPDATE companies SET status='suspended' WHERE id=${company}`;}
console.log(JSON.stringify({passed:checks.length,fixture_company:company,fixture_suspended:true}));
