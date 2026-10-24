import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {readSheet} from 'read-excel-file/node';
import {unzipSync,strFromU8} from 'fflate';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const raw=neon(process.env.BUNYRA_TEST_DATABASE_URL),company=crypto.randomUUID(),foreign=crypto.randomUUID();
const [{tenantSql,bindTenant},ledger,commercial,pricing,crm,payments,adjustments,service,exports,finance]=await Promise.all([
 import('../.sites-runtime/tests/tenant.mjs'),import('../.sites-runtime/tests/ledger.mjs'),import('../.sites-runtime/tests/commercial.mjs'),
 import('../.sites-runtime/tests/pricing.mjs'),import('../.sites-runtime/tests/crm.mjs'),import('../.sites-runtime/tests/payment-accounts.mjs'),
 import('../.sites-runtime/tests/finance-adjustments.mjs'),import('../.sites-runtime/tests/customer-accounts.mjs'),import('../.sites-runtime/tests/customer-accounts-export.mjs'),import('../.sites-runtime/tests/finance-events.mjs')
]);
const owner={userId:'identity-test-platform-owner',email:'platform-test@example.com'},fresh=()=>tenantSql(raw),checks=[];
const check=async(n,fn)=>{await fn();checks.push(n);console.log('PASS '+n)};
await raw`INSERT INTO companies(id,name) VALUES(${company},'Customer accounts DEV'),(${foreign},'Foreign customer accounts DEV')`;
console.log('DEV customer-accounts fixture '+company);
try{
 const entity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${company}`)[0].id;
 await raw`INSERT INTO company_settings(company_id,currency) VALUES(${company},'EGP')`;
 await ledger.initializeAccounting(fresh(),owner,{company_id:company,entity_id:entity,language:'en'},true);
 const gl=await ledger.ledgerOverview(fresh(),owner,company,true),ar=gl.accounts.find(a=>a.role==='receivable'),advance=gl.accounts.find(a=>a.role==='customer_advance'),capital=gl.accounts.find(a=>a.kind==='equity'),journal=gl.journals.find(j=>j.kind==='general');
 const customer=await crm.createCustomer(fresh(),owner,{company_id:company,full_name:'=SUM(A1:A9) & <Customer>',phone:'+201001234567'},true);
 const foreignCustomer=await crm.createCustomer(fresh(),owner,{company_id:foreign,full_name:'Foreign customer',phone:'+201001234568'},true);
 const bank=(await payments.createPaymentAccount(fresh(),owner,{company_id:company,entity_id:entity,code:'LOCAL',name:'Local collection bank',kind:'bank',currency_code:'EGP'},true)).id;
 const usd=(await payments.createPaymentAccount(fresh(),owner,{company_id:company,entity_id:entity,code:'USD',name:'Dollar collection bank',kind:'bank',currency_code:'USD'},true)).id;
 async function manual(ref,date,lines,post=true){const d=await ledger.ledgerCreateDraft(fresh(),owner,{company_id:company,entity_id:entity,journal_id:journal.id,entry_date:date,reference:ref,idempotency_key:'customer-accounts-'+ref,lines:lines.map(l=>({...l,customer_id:customer.id}))},true); if(post)await ledger.ledgerPost(fresh(),owner,{company_id:company,id:d.id},true);return d;}
 const line=(a,d,c)=>({account_id:a.id,debit_minor:String(d),credit_minor:String(c)});
 await manual('AR-OPEN','2026-01-01',[line(ar,100000,0),line(capital,0,100000)]);
 await manual('ADVANCE','2026-02-01',[line(capital,20000,0),line(advance,0,20000)]);
 await manual('TRANSFER','2026-02-02',[line(advance,10000,0),line(ar,0,10000)]);
 await manual('DRAFT','2026-02-02',[line(ar,900,0),line(capital,0,900)],false);
 const statement=(extra={},all=false)=>service.customerStatement(fresh(),owner,{company_id:company,entity_id:entity,customer_id:customer.id,from:'2026-02-01',to:'2026-05-01',...extra},true,all);
 await check('statement opening, advances, AR transfers and running balance agree with posted GL',async()=>{const d=await statement();assert.equal(d.opening_minor,'100000');assert.equal(d.total,3);assert.equal(d.debit_minor,'10000');assert.equal(d.credit_minor,'30000');assert.equal(d.closing_minor,'80000');assert.equal(d.receivable_minor,'90000');assert.equal(d.advance_minor,'10000');assert.equal(d.rows.at(-1).balance_minor,'80000');assert.equal(d.rows.filter(r=>r.reference==='TRANSFER').length,2);assert.equal(d.rows.some(r=>r.reference==='DRAFT'),false)});
 await check('an empty statement period retains its historical opening and closing balances',async()=>{const d=await statement({from:'2026-03-01',to:'2026-03-31'});assert.equal(d.total,0);assert.equal(d.opening_minor,'80000');assert.equal(d.closing_minor,'80000')});
 async function contractFixture(currency,ref,deposit=false){
  const project=crypto.randomUUID(),unit=crypto.randomUUID();
  await raw.transaction([raw`UPDATE company_settings SET currency=${currency} WHERE company_id=${company}`,raw`INSERT INTO projects(id,company_id,name) VALUES(${project},${company},${'Customer project '+ref})`,raw`INSERT INTO inventory_units(id,company_id,project_id,code,building,floor,category,area,proposed_price_minor) VALUES(${unit},${company},${project},${ref},'A','1','Office',100,100000)`]);
  const book=await pricing.savePriceBook(fresh(),owner,{company_id:company,project_id:project,version:0,name:'Test price '+ref,plans:[{code:'PAY',name:'Plan',down_payment_bps:2000,installments:2,interval_months:1,adjustment_bps:0}],prices:[{unit_id:unit,source_unit_version:1,price:'1000.00',plan_codes:['PAY']}]},true);
  await pricing.approvePriceBook(fresh(),owner,{company_id:company,project_id:project,id:book.id,version:book.version,expected_revision:0},true);
  const plan=(await raw`SELECT id FROM price_book_plans WHERE book_id=${book.id}`)[0].id;
  const booking=(await commercial.createBooking(fresh(),owner,{company_id:company,project_id:project,unit_id:unit,plan_id:plan,customer_id:customer.id,date:'2026-01-01',customer_name:customer.full_name,customer_phone:'+201001234567',reservation_amount:'100.00'},true)).booking;
  await commercial.updateBooking(fresh(),owner,{company_id:company,booking_id:booking.id},'approve',true);
  if(deposit)await commercial.updateBooking(fresh(),owner,{company_id:company,booking_id:booking.id,received_amount:'100.00',payment_account_id:currency==='USD'?usd:bank,exchange_rate:currency==='USD'?'48.25':'1'},'confirm_receipt',true);
  const contract=(await commercial.createContract(fresh(),owner,{company_id:company,booking_id:booking.id,date:'2026-01-01'},true)).contract;
  await raw`UPDATE contracts SET signed_at='2026-01-01T10:00:00Z' WHERE id=${contract.id}`;
  if(!deposit)await raw`DELETE FROM contract_installments WHERE company_id=${company} AND contract_id=${contract.id}`;
  else await raw`UPDATE collections SET received_at='2026-01-02T10:00:00Z' WHERE company_id=${company} AND contract_id=${contract.id}`;
  return contract;
 }
 const contract=await contractFixture('EGP','AR-1'),dates=['2026-05-01','2026-05-02','2026-04-30','2026-04-01','2026-03-31','2026-03-02','2026-03-01','2026-01-31','2026-01-30'],installments=[];
 for(let n=0;n<dates.length;n++)installments.push((await raw`INSERT INTO contract_installments(company_id,contract_id,number,due_date,amount_minor) VALUES(${company},${contract.id},${n+1},${dates[n]},10000) RETURNING id`)[0]);
 const aging=(extra={},all=false)=>service.customerAging(fresh(),owner,{company_id:company,entity_id:entity,customer_id:customer.id,as_of:'2026-05-01',currency:'EGP',...extra},true,all);
 await check('all five aging buckets include exact 0,1,30,31,60,61,90,91 day boundaries',async()=>{const d=await aging();assert.equal(d.total,9);assert.deepEqual(d.buckets,{current:'20000',days_1_30:'20000',days_31_60:'20000',days_61_90:'20000',days_91_plus:'10000'});assert.equal(d.due_minor,'90000');assert.equal(d.ledger_net_minor,'80000');assert.equal(d.difference_minor,'10000')});
 const receipt=(await commercial.recordCollection(fresh(),owner,{company_id:company,contract_id:contract.id,installment_id:installments[0].id,amount:'40.00',reference:'Historical collection',payment_account_id:bank,exchange_rate:'1'},true)).collection;
 await raw`UPDATE collections SET received_at='2026-01-02T10:00:00Z' WHERE id=${receipt.id}`;
 const adjust=async(kind,amount,date)=>{const a=await adjustments.createAdjustment(fresh(),owner,{company_id:company,contract_id:contract.id,...(kind==='settlement'?{installment_id:installments[0].id}:{collection_id:receipt.id}),kind,amount,reason:'Historical customer report test'},true);await adjustments.approveAdjustment(fresh(),owner,{company_id:company,adjustment_id:a.id},true);await adjustments.executeAdjustment(fresh(),owner,{company_id:company,adjustment_id:a.id},true);await raw`UPDATE financial_adjustments SET executed_at=${date}::timestamptz WHERE id=${a.id}`;return a;};
 await adjust('refund','10.00','2026-01-03T10:00:00Z');await adjust('reversal','5.00','2026-01-04T10:00:00Z');await adjust('settlement','20.00','2026-01-05T10:00:00Z');
 await check('historical collections, partial refunds, reversals and settlements do not rewrite earlier cutoffs',async()=>{for(const [as_of,expected] of [['2026-01-01','10000'],['2026-01-02','6000'],['2026-01-03','7000'],['2026-01-04','7500'],['2026-01-05','5500']]){const d=await aging({as_of});assert.equal(d.rows.find(r=>r.installment_id===installments[0].id).balance_minor,expected,as_of)}});
 const usdContract=await contractFixture('USD','USD-1');await raw`INSERT INTO contract_installments(company_id,contract_id,number,due_date,amount_minor) VALUES(${company},${usdContract.id},1,'2026-01-31',10000)`;
 await check('contract currencies remain separate and native aging never adds dollars to pounds',async()=>{assert.equal((await aging()).due_minor,'85500');const d=await aging({currency:'USD'});assert.equal(d.total,1);assert.equal(d.due_minor,'10000');assert.equal(d.ledger_net_minor,'0');assert.equal(d.currency,'USD')});
 await raw`UPDATE contracts SET status='cancelled',cancelled_at='2026-05-02T10:00:00Z' WHERE id=${usdContract.id}`;
 await check('later contract cancellation preserves the earlier as-of report',async()=>{assert.equal((await aging({currency:'USD',as_of:'2026-05-01'})).total,1);assert.equal((await aging({currency:'USD',as_of:'2026-05-02'})).total,0);assert.equal((await aging({as_of:'2025-12-31'})).total,0)});
 await check('choices are finance authorized and literal name/phone search is tenant isolated',async()=>{const r=await service.customerAccountChoices(fresh(),owner,{company_id:company,q:'<Customer>'},true);assert.equal(r.rows.length,1);assert.equal(r.rows[0].id,customer.id);assert.equal((await service.customerAccountChoices(fresh(),owner,{company_id:company,q:'+201001234568'},true)).rows.length,0);assert.equal((await service.customerAccountChoices(fresh(),owner,{company_id:company,q:'%'},true)).rows.length,0)});
 const otherEntity=(await raw`INSERT INTO ledger_entities(company_id,code,name) VALUES(${company},'SECOND','Second entity') RETURNING id`)[0].id;
 await check('another entity has its own empty statement and cannot claim company contract schedules',async()=>{assert.equal((await statement({entity_id:otherEntity})).closing_minor,'0');await assert.rejects(()=>aging({entity_id:otherEntity}),e=>e.code==='CUSTOMER_AGING_DEFAULT_ENTITY')});
 for(let n=10;n<=55;n++)await raw`INSERT INTO contract_installments(company_id,contract_id,number,due_date,amount_minor) VALUES(${company},${contract.id},${n},'2026-05-01',1)`;
 for(let n=0;n<48;n++)await manual('PAGE-'+n,'2026-03-01',[line(ar,1,0),line(capital,0,1)]);
 await check('stable paging retains full aging and statement totals and running balances',async()=>{for(const get of [aging,statement]){const a=await get(),b=await get({page:2}),repeat=await get({page:2});assert.equal(a.total, get===aging?55:51);assert.equal(a.rows.length,50);assert.equal(b.rows.length,get===aging?5:1);assert.equal(a.due_minor??a.closing_minor,b.due_minor??b.closing_minor);assert.deepEqual(b.rows,repeat.rows);assert.equal((await get({page:99})).rows.length,0)}});
 await check('complete bilingual XLSX exports preserve all pages, exact money and safe literal cells',async()=>{for(const [get,exporter,title,index] of [[aging,exports.customerAgingXlsx,'أعمار مديونيات العملاء',16],[statement,exports.customerStatementXlsx,'كشف حساب العميل',12]]){const d=await get({},true),file=exporter(d,true),sheet=strFromU8(unzipSync(file)['xl/worksheets/sheet1.xml']);assert.ok(!sheet.includes('<f>'));const rows=await readSheet(Buffer.from(file));assert.equal(rows.length,index+d.total);assert.equal((await readSheet(Buffer.from(exporter(d,false))))[0][0],title);assert.equal(d.rows.length,d.total)}const d=await statement({},true);d.closing_minor='9007199254740993123';assert.equal((await readSheet(Buffer.from(exports.customerStatementXlsx(d,true))))[7][1],'90071992547409931.23')});
 await check('invalid dates, reversed ranges and unsupported currencies fail validation',async()=>{for(const data of [{as_of:'2026-02-30'},{as_of:'0000-01-01'},{currency:'XXX'},{page:0}])await assert.rejects(()=>aging(data));await assert.rejects(()=>statement({from:'2026-06-01',to:'2026-05-01'}),e=>e.code==='INVALID_DATE_RANGE')});
 await check('finance manager can read but denied finance permissions protect reports, choices and exports',async()=>{const user={userId:'customer-manager-'+company,email:'manager@example.test'};await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${user.userId},${user.email},'finance_manager')`;const args={company_id:company,entity_id:entity,customer_id:customer.id,as_of:'2026-05-01'};assert.equal((await service.customerAging(fresh(),user,args)).total,55);await raw`INSERT INTO member_permissions(company_id,user_id,action,allowed) VALUES(${company},${user.userId},'finance.read',false)`;for(const all of [false,true]){await assert.rejects(()=>service.customerAging(fresh(),user,args,false,all),e=>e.code==='FORBIDDEN');await assert.rejects(()=>service.customerStatement(fresh(),user,{company_id:company,entity_id:entity,customer_id:customer.id,from:'2026-01-01',to:'2026-05-01'},false,all),e=>e.code==='FORBIDDEN')}await assert.rejects(()=>service.customerAccountChoices(fresh(),user,{company_id:company}),e=>e.code==='FORBIDDEN')});
 await check('foreign customer IDs, foreign entities and tenant RLS never expose balances',async()=>{await assert.rejects(()=>aging({customer_id:foreignCustomer.id}),e=>e.code==='NOT_FOUND');await assert.rejects(()=>statement({customer_id:foreignCustomer.id}),e=>e.code==='NOT_FOUND');const foreignEntity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${foreign}`)[0].id;await assert.rejects(()=>aging({entity_id:foreignEntity}),e=>e.code==='NOT_FOUND');const s=fresh();bindTenant(s,foreign,owner.userId);assert.equal((await s`SELECT id FROM contract_installments WHERE company_id=${company}`).length,0)});
 await check('allocated booking deposits reduce installments exactly once and disclose pending posting',async()=>{
  const before=await aging(),b=await contractFixture('EGP','DEPOSIT',true);
  await raw`UPDATE finance_events SET event_at='2026-01-02T10:00:00Z' WHERE company_id=${company} AND source_kind='booking' AND source_id=(SELECT booking_id FROM contracts WHERE id=${b.id})`;
  const d=await aging();assert.equal(BigInt(d.due_minor)-BigInt(before.due_minor),90000n);assert.equal(d.rows.filter(r=>r.contract_id===b.id).reduce((n,r)=>n+BigInt(r.collected_minor),0n),10000n);assert.ok(d.pending_events>=1);
  const entryCount=(await raw`SELECT count(*)::int n FROM ledger_entries WHERE company_id=${company} AND state='posted'`)[0].n;
  const [ev]=await raw`SELECT id FROM finance_events WHERE company_id=${company} AND source_kind='booking' AND source_id=(SELECT booking_id FROM contracts WHERE id=${b.id})`;
  await finance.postFinanceEvent(fresh(),owner,{company_id:company,event_id:ev.id},true);
  assert.equal((await raw`SELECT count(*)::int n FROM ledger_entries WHERE company_id=${company} AND state='posted'`)[0].n,entryCount+1);
  assert.equal((await aging()).ledger_advance_minor,'20000');
 });
 await check('foreign customer advances use native currency in aging and historical EGP valuation in statements',async()=>{
  const b=await contractFixture('USD','USD-DEPOSIT',true);
  const [ev]=await raw`UPDATE finance_events SET event_at='2026-01-02T10:00:00Z' WHERE company_id=${company} AND source_kind='booking' AND source_id=(SELECT booking_id FROM contracts WHERE id=${b.id}) RETURNING id`;
  await finance.postFinanceEvent(fresh(),owner,{company_id:company,event_id:ev.id},true);
  const d=await aging({currency:'USD'});assert.equal(d.due_minor,'100000');assert.equal(d.ledger_advance_minor,'10000');assert.equal(d.ledger_net_minor,'-10000');
  const stmt=await statement({from:'2026-01-01'});assert.equal(stmt.rows.find(r=>r.source_type==='booking'&&r.credit_minor==='482500').credit_minor,'482500');
 });
 await check('report reads never create revenue or change source payments and ledger entries',async()=>{const before=await raw`SELECT (SELECT count(*) FROM ledger_entries WHERE company_id=${company})::text AS journals,(SELECT sum(paid_minor) FROM contract_installments WHERE company_id=${company})::text AS paid`;await aging();await statement();const after=await raw`SELECT (SELECT count(*) FROM ledger_entries WHERE company_id=${company})::text AS journals,(SELECT sum(paid_minor) FROM contract_installments WHERE company_id=${company})::text AS paid`;assert.deepEqual(after,before)});
}finally{await raw`UPDATE companies SET status='suspended' WHERE id IN(${company},${foreign})`;}
console.log(JSON.stringify({passed:checks.length,fixture_company:company,fixture_suspended:true}));
