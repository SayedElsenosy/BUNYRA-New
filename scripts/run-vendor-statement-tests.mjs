import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {unzipSync,strFromU8} from 'fflate';
import {readSheet as readXlsx} from 'read-excel-file/node';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const raw=neon(process.env.BUNYRA_TEST_DATABASE_URL);
const [{tenantSql,bindTenant},ledger,ap,statement,exporter]=await Promise.all([import('../.sites-runtime/tests/tenant.mjs'),import('../.sites-runtime/tests/ledger.mjs'),import('../.sites-runtime/tests/vendor-payables.mjs'),import('../.sites-runtime/tests/vendor-statement.mjs'),import('../.sites-runtime/tests/vendor-statement-export.mjs')]);
const owner={userId:'identity-test-platform-owner',email:'platform-test@example.com'},company=crypto.randomUUID(),foreign=crypto.randomUUID(),fresh=()=>tenantSql(raw),checks=[];
const check=async(n,fn)=>{await fn();checks.push(n);console.log('PASS '+n)};
await raw`INSERT INTO companies(id,name) VALUES(${company},'Supplier statement DEV'),(${foreign},'Foreign statement DEV')`;
console.log('DEV supplier-statement fixture '+company);
try{
 const entity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${company}`)[0].id;
 await ledger.initializeAccounting(fresh(),owner,{company_id:company,entity_id:entity,language:'en'},true);
 const gl=await ledger.ledgerOverview(fresh(),owner,company,true),expense=gl.accounts.find(a=>a.code==='5110'),payable=gl.accounts.find(a=>a.role==='payable'),bank=gl.accounts.find(a=>a.role==='bank'),bankJournal=gl.journals.find(j=>j.kind==='bank');
 const vendor=(await ap.createFinanceVendor(fresh(),owner,{company_id:company,code:'STMT',name:'=SUM(A1:A9) & <Supplier>'},true)).vendor;
 const second=(await ap.createFinanceVendor(fresh(),owner,{company_id:company,code:'OTHER',name:'Other vendor'},true)).vendor;
 const createBill=async(ref,id=vendor.id,amount='10000')=>{
  const b=(await ap.createVendorBill(fresh(),owner,{company_id:company,entity_id:entity,vendor_id:id,invoice_number:ref,invoice_date:'2026-01-01',due_date:'2026-01-31',lines:[{expense_account_id:expense.id,description:'Original services',amount_minor:amount}]},true)).bill;
  await ap.approveVendorBill(fresh(),owner,{company_id:company,bill_id:b.id},true);await ap.postVendorBill(fresh(),owner,{company_id:company,bill_id:b.id},true);return b;
 };
 const b=await createBill('STATEMENT-BASE'),otherBill=await createBill('FOREIGN-VENDOR',second.id,'20000');
 const payment=(await ap.payVendorBill(fresh(),owner,{company_id:company,bill_id:b.id,cash_account_id:bank.id,journal_id:bankJournal.id,paid_on:'2026-01-02',amount_minor:'4000',idempotency_key:'statement-payment-key'},true)).payment_id;
 await ap.reverseVendorPayment(fresh(),owner,{company_id:company,payment_id:payment,reversed_on:'2026-01-03',reason:'Correction for statement proof'},true);
 const get=(v={})=>statement.vendorStatement(fresh(),owner,{company_id:company,entity_id:entity,vendor_id:vendor.id,from:'2026-01-01',to:'2026-01-31',page:1,...v},true);
 await check('statement groups source GL lines and retains payment correction history',async()=>{const s=await get();assert.equal(s.total,3);assert.equal(s.opening_minor,'0');assert.equal(s.debit_minor,'4000');assert.equal(s.credit_minor,'14000');assert.equal(s.closing_minor,'10000');assert.deepEqual(s.rows.map(r=>r.balance_minor),['10000','6000','10000']);assert.equal(s.rows[2].source_event,'payment_reversed_'+payment)});
 await check('opening balance includes prior movements and from/to endpoints are inclusive',async()=>{const s=await get({from:'2026-01-02',to:'2026-01-03'});assert.equal(s.opening_minor,'10000');assert.equal(s.total,2);assert.equal(s.debit_minor,'4000');assert.equal(s.credit_minor,'4000');assert.equal(s.closing_minor,'10000')});
 await check('no-activity date ranges retain opening and closing balance',async()=>{const s=await get({from:'2026-02-01',to:'2026-02-28'});assert.equal(s.total,0);assert.deepEqual(s.rows,[]);assert.equal(s.opening_minor,'10000');assert.equal(s.closing_minor,'10000')});
 await check('other suppliers do not leak into the selected statement',async()=>{const s=await get({vendor_id:second.id});assert.equal(s.total,1);assert.equal(s.closing_minor,'20000')});
 // Isolated synthetic journals exercise pagination, multiple account mappings and draft exclusion.
 await raw`INSERT INTO ledger_entries(id,company_id,entity_id,journal_id,entry_date,reference,description,idempotency_key,payload_hash,created_by)
  SELECT gen_random_uuid(),${company},${entity},${bankJournal.id},'2026-01-04', 'STMT-PAGE-'||n, 'Manual supplier adjustment', 'statement-page-'||n,encode(sha256(convert_to(n::text,'UTF8')),'hex'),${owner.userId} FROM generate_series(1,54) n`;
 await raw`INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,vendor_id,description,debit_minor,credit_minor)
  SELECT ${company}::uuid,${entity}::uuid,id,1,${expense.id}::uuid,${vendor.id}::uuid,'Manual adjustment expense',1,0 FROM ledger_entries WHERE company_id=${company} AND reference LIKE 'STMT-PAGE-%'
  UNION ALL SELECT ${company}::uuid,${entity}::uuid,id,2,${payable.id}::uuid,${vendor.id}::uuid,'Manual adjustment payable',0,1 FROM ledger_entries WHERE company_id=${company} AND reference LIKE 'STMT-PAGE-%'`;
 const bound=fresh();bindTenant(bound,company,owner.userId);await bound`SELECT bunyra_ledger_post_entry(${company}::uuid,id) FROM ledger_entries WHERE company_id=${company} AND reference LIKE 'STMT-PAGE-%' AND reference<>'STMT-PAGE-54'`;
 await check('pagination has stable order, full totals and running balance across pages',async()=>{const p1=await get(),p2=await get({page:2}),again=await get({page:2});assert.equal(p1.total,56);assert.equal(p1.rows.length,50);assert.equal(p2.rows.length,6);assert.equal(p1.closing_minor,'10053');assert.equal(p2.closing_minor,'10053');assert.equal(p2.rows[0].balance_minor,String(BigInt(p1.rows.at(-1).balance_minor)+1n));assert.deepEqual(p2.rows,again.rows);assert.equal(new Set([...p1.rows,...p2.rows].map(r=>r.entry_id)).size,56)});
 await check('requested pages beyond the end stay empty without losing statement totals',async()=>{const s=await get({page:999});assert.equal(s.rows.length,0);assert.equal(s.total,56);assert.equal(s.closing_minor,'10053')});
 const originalLines=(await ap.vendorCreditBillLines(fresh(),owner,company,b.id,true)).lines;
 const credit=(await ap.postVendorCredit(fresh(),owner,{company_id:company,bill_id:b.id,reference:'STATEMENT-CREDIT',credit_date:'2026-01-05',reason:'Statement source credit',idempotency_key:'statement-credit-key',lines:[{bill_line_id:originalLines[0].id,amount_minor:'1000'}]},true)).credit_id;
 await ap.reverseVendorCredit(fresh(),owner,{company_id:company,credit_id:credit,reversed_on:'2026-01-06',reason:'Statement credit correction'},true);
 await check('credit originals and corrections both remain visible and agree with direct payable GL',async()=>{const s=await get({page:2});assert.equal(s.total,58);assert.equal(s.closing_minor,'10053');assert.ok(s.rows.some(r=>r.source_event==='credit_'+credit));const [direct]=await raw`SELECT sum(l.credit_minor::numeric-l.debit_minor::numeric)::text total FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.account_id JOIN ledger_entries e ON e.id=l.entry_id WHERE l.company_id=${company} AND l.vendor_id=${vendor.id} AND a.role='payable' AND e.state='posted'`;assert.equal(direct.total,s.closing_minor)});
 await check('invalid calendar dates, reversed ranges, malformed IDs and page numbers fail validation',async()=>{for(const v of [{from:'2026-02-30'},{from:'2026-02-01',to:'2026-01-31'},{vendor_id:'invalid'},{page:0},{page:'Infinity'}])await assert.rejects(()=>get(v))});
 const paymentAccounts=await import('../.sites-runtime/tests/payment-accounts.mjs');
 const receiving=(await paymentAccounts.createPaymentAccount(fresh(),owner,{company_id:company,entity_id:entity,code:'STMT-BANK',name:'Statement bank',currency_code:'EGP',kind:'bank'},true)).id;
 await ap.payVendorBill(fresh(),owner,{company_id:company,bill_id:otherBill.id,cash_account_id:bank.id,journal_id:bankJournal.id,paid_on:'2026-01-07',amount_minor:'20000',idempotency_key:'statement-other-payment'},true);
 const [otherLine]=(await ap.vendorCreditBillLines(fresh(),owner,company,otherBill.id,true)).lines;
 const otherCredit=(await ap.postVendorCredit(fresh(),owner,{company_id:company,bill_id:otherBill.id,reference:'REFUND-STMT-CREDIT',credit_date:'2026-01-08',reason:'Supplier refund statement proof',idempotency_key:'refund-statement-credit',lines:[{bill_line_id:otherLine.id,amount_minor:'1000'}]},true)).credit_id;
 await check('supplier overpayment is an exact negative receivable balance at the selected cutoff',async()=>{const s=await get({vendor_id:second.id,from:'2026-01-08',to:'2026-01-08'});assert.equal(s.opening_minor,'0');assert.equal(s.closing_minor,'-1000');assert.equal(s.rows.length,1)});
 const receipt=(await ap.receiveVendorRefund(fresh(),owner,{company_id:company,credit_id:otherCredit,payment_account_id:receiving,received_on:'2026-01-09',amount_minor:'1000',reference:'REFUND-STMT-RECEIPT',idempotency_key:'refund-statement-receipt'},true)).refund_id;
 await ap.reverseVendorRefund(fresh(),owner,{company_id:company,refund_id:receipt,reversed_on:'2026-01-10',reason:'Refund statement correction'},true);
 await ap.reverseVendorCredit(fresh(),owner,{company_id:company,credit_id:otherCredit,reversed_on:'2026-01-11',reason:'Credit statement correction'},true);
 await check('received refunds and their corrections remain separate GL movements with zero final payable',async()=>{const s=await get({vendor_id:second.id});assert.equal(s.total,6);assert.equal(s.closing_minor,'0');assert.ok(s.rows.some(r=>r.source_event==='refund_'+receipt));assert.ok(s.rows.some(r=>r.source_event==='refund_reversed_'+receipt));assert.ok(s.rows.some(r=>r.source_event==='credit_reversed_'+otherCredit));assert.deepEqual(s.rows.map(r=>r.balance_minor),['20000','0','-1000','0','-1000','0'])});
 await check('full XLSX export contains every page, exact amounts and literal formula-like vendor names',async()=>{
  const s=await statement.vendorStatement(fresh(),owner,{company_id:company,entity_id:entity,vendor_id:vendor.id,from:'2026-01-01',to:'2026-01-31'},true,true);assert.equal(s.rows.length,58);
  const file=exporter.vendorStatementXlsx(s,true),rows=await readXlsx(Buffer.from(file));assert.equal(rows.length,67);assert.equal(rows[0][2],vendor.name);assert.equal(rows[6][1],'100.53');assert.equal(rows.at(-1)[6],'100.53');
  const xml=strFromU8(unzipSync(file)['xl/worksheets/sheet1.xml']);assert.ok(!xml.includes('<f>'));assert.ok(xml.includes('&lt;Supplier&gt;'));assert.ok(xml.includes('rightToLeft="0"'));const ar=await readXlsx(Buffer.from(exporter.vendorStatementXlsx(s,false)));assert.equal(ar[0][0],'كشف حساب المورد');
 });
 await check('XLSX preserves amounts above JS and Excel integer precision as exact text',async()=>{const s=await get();s.closing_minor='9007199254740993123';const rows=await readXlsx(Buffer.from(exporter.vendorStatementXlsx(s,true)));assert.equal(rows[6][1],'90071992547409931.23')});
 await check('finance read denial and role restrictions protect the report and export path',async()=>{
  const user={userId:'statement-denied-'+company,email:'denied@example.test'};await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${user.userId},${user.email},'finance_manager')`;
  const allowed=await statement.vendorStatement(fresh(),user,{company_id:company,entity_id:entity,vendor_id:vendor.id,from:'2026-01-01',to:'2026-01-31'});assert.equal(allowed.closing_minor,'10053');
  await raw`INSERT INTO member_permissions(company_id,user_id,action,allowed) VALUES(${company},${user.userId},'finance.read',false)`;
  for(const exporting of [false,true])await assert.rejects(()=>statement.vendorStatement(fresh(),user,{company_id:company,entity_id:entity,vendor_id:vendor.id,from:'2026-01-01',to:'2026-01-31'},false,exporting),e=>e.code==='FORBIDDEN');
 });
 await check('real foreign vendor and entity IDs are rejected without disclosing ledger rows',async()=>{const foreignEntity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${foreign}`)[0].id;await assert.rejects(()=>get({entity_id:foreignEntity}),e=>e.code==='NOT_FOUND');await assert.rejects(()=>get({company_id:foreign,entity_id:foreignEntity}),e=>e.code==='NOT_FOUND');const s=fresh();bindTenant(s,foreign,owner.userId);assert.equal((await s`SELECT id FROM ledger_lines WHERE vendor_id=${vendor.id}`).length,0)});
}finally{await raw`UPDATE companies SET status='suspended' WHERE id IN(${company},${foreign})`;}
console.log(JSON.stringify({passed:checks.length,fixture_company:company,fixture_suspended:true}));
