import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const raw=neon(process.env.BUNYRA_TEST_DATABASE_URL);
const [{tenantSql,bindTenant},ledger,ap,bank,controls]=await Promise.all([
 import('../.sites-runtime/tests/tenant.mjs'),import('../.sites-runtime/tests/ledger.mjs'),
 import('../.sites-runtime/tests/vendor-payables.mjs'),import('../.sites-runtime/tests/treasury.mjs'),import('../.sites-runtime/tests/ledger-controls.mjs')
]);
const company=crypto.randomUUID(),part=company.slice(0,8),owner={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
const fresh=()=>tenantSql(raw),checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
await raw`INSERT INTO companies(id,name) VALUES(${company},${'Supplier correction DEV '+part})`;
const entity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${company} AND is_default`)[0].id;
await ledger.initializeAccounting(fresh(),owner,{company_id:company,entity_id:entity,language:'en'},true);
const gl=await ledger.ledgerOverview(fresh(),owner,company,true);
const cash=gl.accounts.find(a=>a.role==='bank'),expense=gl.accounts.find(a=>a.code==='5110'),journal=gl.journals.find(j=>j.kind==='bank');
const vendor=(await ap.createFinanceVendor(fresh(),owner,{company_id:company,code:'V01',name:'Correction test supplier'},true)).vendor;
const bill=(await ap.createVendorBill(fresh(),owner,{company_id:company,entity_id:entity,vendor_id:vendor.id,invoice_number:'INV-'+part,
 invoice_date:'2026-01-01',due_date:'2026-01-31',lines:[{expense_account_id:expense.id,description:'Services',amount_minor:'10000'}]},true)).bill;
await ap.approveVendorBill(fresh(),owner,{company_id:company,bill_id:bill.id},true);
await ap.postVendorBill(fresh(),owner,{company_id:company,bill_id:bill.id},true);
const pay=(amount,key,date='2026-01-10')=>ap.payVendorBill(fresh(),owner,{company_id:company,bill_id:bill.id,journal_id:journal.id,cash_account_id:cash.id,paid_on:date,amount_minor:amount,idempotency_key:key},true);
const original=await pay('4000','initial-correction-'+part);
const reverse=(id,date='2026-01-11',reason='Correct an erroneously recorded payment')=>ap.reverseVendorPayment(fresh(),owner,{company_id:company,payment_id:id,reversed_on:date,reason},true);
let correction;
await check('correction cannot precede the original payment',async()=>{
 await assert.rejects(()=>reverse(original.payment_id,'2026-01-09'),e=>e.message==='VENDOR_REVERSAL_BEFORE_PAYMENT');
});
await check('two concurrent correction requests create one counter-entry and audit',async()=>{
 const r=await Promise.all([reverse(original.payment_id),reverse(original.payment_id)]);assert.equal(r[0].reversal_id,r[1].reversal_id);correction=r[0].reversal_id;
 assert.equal((await raw`SELECT count(*)::int n FROM finance_vendor_payment_reversals WHERE company_id=${company}`)[0].n,1);
 assert.equal((await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${company} AND action='finance.vendor_payment_reversed'`)[0].n,1);
});
await check('a changed retry cannot replace the accepted correction details',async()=>{
 await assert.rejects(()=>reverse(original.payment_id,'2026-01-12','Different correction'),e=>e.message==='VENDOR_REVERSAL_CONFLICT');
});
await check('counter-entry is exact and preserves original supplier dimensions',async()=>{
 const [r]=await raw`SELECT sum(l.debit_minor-l.credit_minor)::text net,count(*)::int lines,count(*) FILTER(WHERE l.vendor_id=${vendor.id})::int supplier_lines
 FROM finance_vendor_payments p JOIN finance_vendor_payment_reversals r ON r.company_id=p.company_id AND r.payment_id=p.id
 JOIN ledger_lines l ON l.company_id=p.company_id AND l.entry_id IN(p.posted_entry_id,r.posted_entry_id) WHERE p.company_id=${company} AND p.id=${original.payment_id}`;
 assert.deepEqual(r,{net:'0',lines:4,supplier_lines:4});
 const lines=await raw`SELECT a.account_id,a.debit_minor::text original_debit,a.credit_minor::text original_credit,b.debit_minor::text reversed_debit,b.credit_minor::text reversed_credit
 FROM finance_vendor_payments p JOIN finance_vendor_payment_reversals r ON r.payment_id=p.id AND r.company_id=p.company_id
 JOIN ledger_lines a ON a.entry_id=p.posted_entry_id JOIN ledger_lines b ON b.entry_id=r.posted_entry_id AND b.line_number=a.line_number AND b.account_id=a.account_id WHERE p.id=${original.payment_id}`;
 assert.equal(lines.length,2);assert.ok(lines.every(l=>l.original_debit===l.reversed_credit&&l.original_credit===l.reversed_debit));
});
await check('invoice amount due and supplier subledger reopen after correction',async()=>{
 const view=await ap.vendorPayablesOverview(fresh(),owner,company,true),b=view.bills.find(b=>b.id===bill.id);
 assert.equal(b.paid_minor,'0');assert.equal(b.remaining_minor,'10000');assert.equal(view.payments[0].reversal_id,correction);
 const [r]=await raw`SELECT sum(l.credit_minor-l.debit_minor)::text remaining FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.account_id JOIN ledger_entries e ON e.id=l.entry_id WHERE l.company_id=${company} AND l.vendor_id=${vendor.id} AND a.role='payable' AND e.state='posted'`;
 assert.equal(r.remaining,'10000');
});
await check('old payment idempotency key cannot resurrect a reversed payment',async()=>{
 await assert.rejects(()=>pay('4000','initial-correction-'+part),e=>e.message==='VENDOR_PAYMENT_REVERSED');
});
const second=await pay('7000','replacement-'+part,'2026-01-12');
await check('replacement payment uses the reopened balance and still prevents overpayment',async()=>{
 const view=await ap.vendorPayablesOverview(fresh(),owner,company,true);assert.equal(view.bills[0].remaining_minor,'3000');
 await assert.rejects(()=>pay('3001','overpayment-'+part),e=>e.message==='VENDOR_PAYMENT_OVERPAID');
});
await check('locked-period correction rolls back all new rows and leaves the payment active',async()=>{
 await controls.lockLedgerPeriod(fresh(),owner,{company_id:company,entity_id:entity,from:'2026-01-13',to:'2026-01-13',reason:'Closed period correction test'},true);
 await assert.rejects(()=>reverse(second.payment_id,'2026-01-13'),e=>e.message==='LEDGER_PERIOD_LOCKED');
 assert.equal((await raw`SELECT count(*)::int n FROM finance_vendor_payment_reversals WHERE company_id=${company}`)[0].n,1);
 assert.equal((await raw`SELECT count(*)::int n FROM ledger_entries WHERE company_id=${company} AND source_event=${'payment_reversed_'+second.payment_id}`)[0].n,0);
});
async function movement(payment,amount,ref){
 const stmt=(await bank.createBankStatement(fresh(),owner,{company_id:company,entity_id:entity,bank_account_id:cash.id,statement_ref:ref,date_from:'2026-01-01',date_to:'2026-01-31',opening_minor:'0',closing_minor:'-'+amount},true)).statement;
 const line=(await bank.importBankLines(fresh(),owner,{company_id:company,statement_id:stmt.id,lines:[{external_ref:ref,booked_on:'2026-01-15',signed_minor:'-'+amount}]},true)).imported[0];
 const [ledgerLine]=await raw`SELECT l.id FROM ledger_lines l JOIN finance_vendor_payments p ON p.company_id=l.company_id AND p.posted_entry_id=l.entry_id WHERE p.company_id=${company} AND p.id=${payment} AND l.account_id=${cash.id}`;
 return {line:line.id,ledgerLine:ledgerLine.id};
}
await check('reconciled supplier payment cannot be reversed',async()=>{
 const m=await movement(second.payment_id,'7000','matched-'+part);
 await bank.reconcileBankLine(fresh(),owner,{company_id:company,bank_line_id:m.line,ledger_line_id:m.ledgerLine},true);
 await assert.rejects(()=>reverse(second.payment_id,'2026-01-14'),e=>e.message==='VENDOR_PAYMENT_RECONCILED');
});
await check('reversed payment and its correction are removed from bank matching candidates',async()=>{
 const [p]=await raw`SELECT posted_entry_id FROM finance_vendor_payments WHERE id=${original.payment_id}`;
 const [r]=await raw`SELECT posted_entry_id FROM finance_vendor_payment_reversals WHERE id=${correction}`;
 const lines=(await raw`SELECT id FROM ledger_lines WHERE entry_id=ANY(${[p.posted_entry_id,r.posted_entry_id]}::uuid[])`).map(l=>l.id);
 const view=await bank.treasuryOverview(fresh(),owner,company,true);assert.ok(!view.candidates.some(l=>lines.includes(l.id)));
 const m=await movement(original.payment_id,'4000','reversed-'+part);
 await assert.rejects(()=>bank.reconcileBankLine(fresh(),owner,{company_id:company,bank_line_id:m.line,ledger_line_id:m.ledgerLine},true),e=>e.message==='VENDOR_PAYMENT_REVERSED');
});
await check('bank match and payment correction cannot both win a real concurrent race',async()=>{
 const p=await pay('1000','race-'+part,'2026-01-15'),m=await movement(p.payment_id,'1000','race-'+part);
 const r=await Promise.allSettled([reverse(p.payment_id,'2026-01-16'),bank.reconcileBankLine(fresh(),owner,{company_id:company,bank_line_id:m.line,ledger_line_id:m.ledgerLine},true)]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);const failure=r.find(x=>x.status==='rejected').reason;
 assert.ok(['VENDOR_PAYMENT_RECONCILED','VENDOR_PAYMENT_REVERSED'].includes(failure.message));
});
await check('immutable originals and correction records cannot be altered or deleted',async()=>{
 await assert.rejects(()=>raw`UPDATE finance_vendor_payment_reversals SET reason='Rewrite history' WHERE id=${correction}`,e=>e.message==='VENDOR_PAYMENT_IMMUTABLE');
 await assert.rejects(()=>raw`DELETE FROM finance_vendor_payment_reversals WHERE id=${correction}`,e=>e.message==='VENDOR_PAYMENT_IMMUTABLE');
});
await check('sales and explicit approval-denied managers cannot reverse payments',async()=>{
 const seller={userId:'reverse-seller-'+part,email:'seller@example.test'},manager={userId:'reverse-manager-'+part,email:'manager@example.test'};
 await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${seller.userId},${seller.email},'sales'),(${company},${manager.userId},${manager.email},'finance_manager')`;
 await raw`INSERT INTO member_permissions(company_id,user_id,action,allowed) VALUES(${company},${manager.userId},'finance.approve',false)`;
 for(const actor of [seller,manager])await assert.rejects(()=>ap.reverseVendorPayment(fresh(),actor,{company_id:company,payment_id:second.payment_id,reversed_on:'2026-01-16',reason:'Forbidden correction'}),e=>e.code==='FORBIDDEN');
 const direct=fresh();bindTenant(direct,company,manager.userId);
 await assert.rejects(()=>direct`SELECT bunyra_reverse_vendor_payment(${company}::uuid,${second.payment_id}::uuid,'2026-01-16','Direct bypass attempt')`,e=>e.code==='42501'&&e.message==='LEDGER_FORBIDDEN');
 const outsider=fresh();bindTenant(outsider,company,'foreign-supplier-correction-user');
 assert.equal((await outsider`SELECT id FROM finance_vendor_payment_reversals WHERE company_id=${company}`).length,0);
});
await raw`UPDATE companies SET status='suspended' WHERE id=${company}`;
console.log(JSON.stringify({passed:checks.length,fixture_company:company,fixture_suspended:true}));
