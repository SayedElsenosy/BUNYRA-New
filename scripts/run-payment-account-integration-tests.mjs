import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const raw=neon(process.env.BUNYRA_TEST_DATABASE_URL);
const [{tenantSql},ledger,payments,commercial,pricing,crm,treasury,finance,adjustments]=await Promise.all([
 import('../.sites-runtime/tests/tenant.mjs'),import('../.sites-runtime/tests/ledger.mjs'),
 import('../.sites-runtime/tests/payment-accounts.mjs'),import('../.sites-runtime/tests/commercial.mjs'),
 import('../.sites-runtime/tests/pricing.mjs'),import('../.sites-runtime/tests/crm.mjs'),
 import('../.sites-runtime/tests/treasury.mjs'),import('../.sites-runtime/tests/finance-events.mjs'),import('../.sites-runtime/tests/finance-adjustments.mjs')
]);
const owner={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
const company=crypto.randomUUID(),project=crypto.randomUUID(),unit=crypto.randomUUID(),part=company.slice(0,8);
const approver={userId:'payment-approver-'+part,email:'payment-approver@example.test'};
const fresh=()=>tenantSql(raw),checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
await raw.transaction([
 raw`INSERT INTO companies(id,name) VALUES(${company},${'Payment accounts DEV '+part})`,
 raw`INSERT INTO company_settings(company_id,currency) VALUES(${company},'USD')`,
 raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${approver.userId},${approver.email},'finance_manager')`,
 raw`INSERT INTO projects(id,company_id,name) VALUES(${project},${company},'Foreign receipt test')`,
 raw`INSERT INTO inventory_units(id,company_id,project_id,code,building,floor,category,area,proposed_price_minor)
 VALUES(${unit},${company},${project},'FX-1','A','1','Office',100,100000)`
]);
const entity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${company}`)[0].id;
let egp,usd,usd2,booking,contract,installment,collection;
await check('chart initialization never chooses cash or bank for the user',async()=>{
 await ledger.initializeAccounting(fresh(),owner,{company_id:company,entity_id:entity,language:'en'},true);
 assert.equal((await raw`SELECT count(*)::int n FROM finance_account_mappings WHERE company_id=${company}`)[0].n,0);
 assert.equal((await raw`SELECT count(*)::int n FROM company_payment_accounts WHERE company_id=${company}`)[0].n,0);
});
await check('company supports several separate bank accounts and currencies',async()=>{
 const create=(code,currency)=>payments.createPaymentAccount(fresh(),owner,{company_id:company,entity_id:entity,code,name:'Bank '+code,kind:'bank',currency_code:currency},true);
 egp=(await create('LOCAL','EGP')).id;usd=(await create('USD1','USD')).id;usd2=(await create('USD2','USD')).id;
 const overview=await treasury.treasuryOverview(fresh(),owner,company,true);
 assert.equal(overview.payment_accounts.length,3);assert.equal(new Set(overview.payment_accounts.map(a=>a.account_id)).size,3);
 assert.deepEqual(overview.balances.map(a=>a.native_balance_minor),['0','0','0']);
});
await check('duplicate code rolls back both bank ledger and journal creation',async()=>{
 await assert.rejects(()=>payments.createPaymentAccount(fresh(),owner,{company_id:company,entity_id:entity,code:'USD1',name:'Duplicate bank',kind:'bank',currency_code:'EUR'},true),e=>e.code==='23505');
 assert.equal((await raw`SELECT count(*)::int n FROM ledger_accounts WHERE company_id=${company} AND role='bank'`)[0].n,4);
});
const customer=await crm.createCustomer(fresh(),owner,{company_id:company,full_name:'Foreign currency customer',phone:'+201001234567',email:''},true);
const book=await pricing.savePriceBook(fresh(),owner,{company_id:company,project_id:project,version:0,name:'USD prices',plans:[{code:'PAY',name:'Payment plan',down_payment_bps:2000,installments:2,interval_months:1,adjustment_bps:0}],prices:[{unit_id:unit,source_unit_version:1,price:'1000.00',plan_codes:['PAY']}]},true);
await pricing.approvePriceBook(fresh(),owner,{company_id:company,project_id:project,id:book.id,version:book.version,expected_revision:0},true);
const plan=(await raw`SELECT id FROM price_book_plans WHERE book_id=${book.id}`)[0].id;
booking=(await commercial.createBooking(fresh(),owner,{company_id:company,project_id:project,unit_id:unit,plan_id:plan,customer_id:customer.id,date:'2026-10-23',customer_name:'Foreign currency customer',customer_phone:'+201001234567',reservation_amount:'100.00'},true)).booking;
await commercial.updateBooking(fresh(),owner,{company_id:company,booking_id:booking.id},'approve',true);
const confirm=(extra={})=>commercial.updateBooking(fresh(),owner,{company_id:company,booking_id:booking.id,received_amount:'100.00',...extra},'confirm_receipt',true);
await check('receipt requires an explicit destination with no fallback',async()=>{
 await assert.rejects(()=>confirm(),e=>e.message==='PAYMENT_ACCOUNT_REQUIRED');
 assert.equal((await raw`SELECT status FROM bookings WHERE id=${booking.id}`)[0].status,'approved');
});
await check('contract currency and bank account currency must match',async()=>{
 await assert.rejects(()=>confirm({payment_account_id:egp,exchange_rate:'1'}),e=>e.message==='PAYMENT_ACCOUNT_CURRENCY_MISMATCH');
});
await check('foreign receipt requires a positive explicitly entered exchange rate',async()=>{
 await assert.rejects(()=>confirm({payment_account_id:usd}),e=>e.message==='EXCHANGE_RATE_REQUIRED');
 await assert.rejects(()=>confirm({payment_account_id:usd,exchange_rate:'0'}),e=>e.message==='EXCHANGE_RATE_REQUIRED');
});
await finance.configureFinanceAutomation(fresh(),owner,{company_id:company,enabled:true},true);
await check('USD receipt records native USD and EGP valuation without double counting',async()=>{
 await confirm({payment_account_id:usd,exchange_rate:'48.25'});
 const event=(await raw`SELECT status,amount_minor::text,payload FROM finance_events WHERE company_id=${company} AND source_kind='booking'`)[0];
 assert.equal(event.status,'posted');assert.equal(event.amount_minor,'482500');assert.equal(event.payload.native_amount_minor,'10000');assert.equal(event.payload.currency_code,'USD');
 const overview=await treasury.treasuryOverview(fresh(),owner,company,true);
 const balance=overview.balances.find(a=>a.id===usd);assert.equal(balance.native_balance_minor,'10000');assert.equal(balance.base_balance_minor,'482500');
 assert.equal(overview.balances.find(a=>a.id===usd2).native_balance_minor,'0');
});
await check('confirmed receipt destination, rate and amount are immutable',async()=>{
 for(const query of [raw`UPDATE bookings SET payment_account_id=${usd2} WHERE id=${booking.id}`,raw`UPDATE bookings SET receipt_exchange_rate=49 WHERE id=${booking.id}`,raw`UPDATE bookings SET received_amount_minor=1 WHERE id=${booking.id}`])
 await assert.rejects(()=>query,e=>e.message==='RECEIPT_DESTINATION_IMMUTABLE');
});
await check('contract receipt allocation preserves destination without another cash event',async()=>{
 contract=(await commercial.createContract(fresh(),owner,{company_id:company,booking_id:booking.id,date:'2026-10-23'},true)).contract;
 const row=(await raw`SELECT payment_account_id,receipt_exchange_rate::text FROM collections WHERE company_id=${company} AND contract_id=${contract.id}`)[0];assert.equal(row.payment_account_id,usd);
 assert.equal((await raw`SELECT count(*)::int n FROM ledger_entries WHERE company_id=${company} AND state='posted'`)[0].n,1);
 installment=(await raw`SELECT id FROM contract_installments WHERE company_id=${company} AND contract_id=${contract.id} AND number=1`)[0].id;
});
await check('each later collection can select a different bank independently',async()=>{
 collection=(await commercial.recordCollection(fresh(),owner,{company_id:company,contract_id:contract.id,installment_id:installment,amount:'50.01',reference:'Second bank receipt',payment_account_id:usd2,exchange_rate:'48.12345678'},true)).collection;
 const overview=await treasury.treasuryOverview(fresh(),owner,company,true);
 assert.equal(overview.balances.find(a=>a.id===usd).native_balance_minor,'10000');
 const balance=overview.balances.find(a=>a.id===usd2);assert.equal(balance.native_balance_minor,'5001');assert.equal(balance.base_balance_minor,'240665');
});
await check('bank reconciliation compares native amount rather than EGP base valuation',async()=>{
 const overview=await treasury.treasuryOverview(fresh(),owner,company,true),account=overview.payment_accounts.find(a=>a.id===usd2);
 const statement=(await treasury.createBankStatement(fresh(),owner,{company_id:company,entity_id:entity,bank_account_id:account.account_id,statement_ref:'USD-STATEMENT',date_from:'2026-10-01',date_to:'2026-10-31',opening_minor:'0',closing_minor:'5001'},true)).statement;
 const line=(await treasury.importBankLines(fresh(),owner,{company_id:company,statement_id:statement.id,lines:[{external_ref:'USD-NATIVE',booked_on:'2026-10-23',signed_minor:'5001'}]},true)).imported[0];
 const candidate=overview.candidates.find(a=>a.account_id===account.account_id);assert.equal(candidate.amount_currency_minor,'5001');
 await treasury.reconcileBankLine(fresh(),owner,{company_id:company,bank_line_id:line.id,ledger_line_id:candidate.id},true);
 await treasury.closeBankStatement(fresh(),owner,{company_id:company,statement_id:statement.id},true);
});
await check('retries never duplicate either native or base currency balances',async()=>{
 await finance.processFinanceOutbox(fresh(),owner,{company_id:company},true);
 assert.equal((await raw`SELECT count(*)::int n FROM ledger_entries WHERE company_id=${company} AND state='posted'`)[0].n,2);
});
await check('manual base-only vouchers cannot silently enter a foreign bank account',async()=>{
 const view=await ledger.ledgerOverview(fresh(),owner,company,true),bank=(await treasury.treasuryOverview(fresh(),owner,company,true)).payment_accounts.find(a=>a.id===usd);
 await assert.rejects(()=>ledger.ledgerCreateDraft(fresh(),owner,{company_id:company,entity_id:entity,journal_id:bank.journal_id,
  entry_date:'2026-10-23',reference:'INVALID-FX-MANUAL',idempotency_key:'invalid-native-'+part,
  lines:[{account_id:bank.account_id,debit_minor:'100',credit_minor:'0'},{account_id:view.accounts.find(a=>a.role==='customer_advance').id,debit_minor:'0',credit_minor:'100'}]},true),e=>e.message==='PAYMENT_CURRENCY_SNAPSHOT_REQUIRED');
 assert.equal((await raw`SELECT count(*)::int n FROM ledger_entries WHERE company_id=${company} AND reference='INVALID-FX-MANUAL'`)[0].n,0);
});
await check('split foreign refunds clear native and base balances with exact cumulative rounding',async()=>{
 for(const amount of ['25.00','25.01']){
  const a=await adjustments.createAdjustment(fresh(),owner,{company_id:company,contract_id:contract.id,collection_id:collection.id,kind:'refund',amount,reason:'Return to original bank at original historical receipt rate'},true);
  await adjustments.approveAdjustment(fresh(),approver,{company_id:company,adjustment_id:a.id});
  await adjustments.executeAdjustment(fresh(),owner,{company_id:company,adjustment_id:a.id},true);
 }
 const overview=await treasury.treasuryOverview(fresh(),owner,company,true),balance=overview.balances.find(a=>a.id===usd2);
 assert.equal(balance.native_balance_minor,'0');assert.equal(balance.base_balance_minor,'0');
 const events=await raw`SELECT status,amount_minor::text,payload FROM finance_events WHERE company_id=${company} AND processing_kind='cash_refunded'`;
 assert.equal(events.length,2);assert.ok(events.every(e=>e.status==='posted'&&e.payload.payment_account_id===usd2));
 assert.equal(events.reduce((sum,e)=>sum+BigInt(e.amount_minor),0n),240665n);
});
await check('sales cannot create company bank accounts',async()=>{
 const seller={userId:'bank-seller-'+part,email:'seller@example.test'};
 await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${seller.userId},${seller.email},'sales')`;
 await assert.rejects(()=>payments.createPaymentAccount(fresh(),seller,{company_id:company,entity_id:entity,code:'DENIED',name:'No access',kind:'bank',currency_code:'USD'}),e=>e.code==='FORBIDDEN');
});
await raw`UPDATE companies SET status='suspended' WHERE id=${company}`;
console.log(JSON.stringify({passed:checks.length,fixture_company:company,fixture_suspended:true},null,2));
