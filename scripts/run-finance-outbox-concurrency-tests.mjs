import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const raw=neon(process.env.BUNYRA_TEST_DATABASE_URL);
const [{tenantSql},finance,ledger,{runFinanceSchedule}]=await Promise.all([
 import('../.sites-runtime/tests/tenant.mjs'),import('../.sites-runtime/tests/finance-events.mjs'),
 import('../.sites-runtime/tests/ledger.mjs'),import('../hosting/finance-scheduler.mjs')
]);
const owner={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
const company=crypto.randomUUID(),eventId=crypto.randomUUID(),source=crypto.randomUUID(),part=company.slice(0,8);
const seller={userId:'outbox-seller-'+part,email:'outbox-seller@example.test'};
const manager={userId:'outbox-manager-'+part,email:'outbox-manager@example.test'};
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const fresh=()=>tenantSql(raw);
// This dedicated fixture is committed so independent HTTP transactions can race.
// It is suspended at the end and retains its immutable test journal for inspection.
await raw`INSERT INTO companies(id,name) VALUES(${company},${'Outbox concurrency DEV '+part})`;
const entity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${company} AND is_default`)[0].id;
await check('authorized service initializes chart and exact receipt/payable mappings',async()=>{
 const r=await ledger.initializeAccounting(fresh(),owner,{company_id:company,entity_id:entity,language:'en'},true);
 assert.equal(r.setup.created_accounts,11);assert.equal(r.setup.created_journals,5);
 const overview=await finance.financeEventsOverview(fresh(),owner,company,true);
 assert.equal(overview.automation.enabled,false);assert.equal(overview.mappings.length,0);assert.equal(overview.receipt_controls.length,1);
});
// The race below deliberately exercises the supported legacy-event adapter.
// The per-receipt path is covered by run-payment-account-integration-tests.mjs.
await raw`DELETE FROM finance_receipt_controls WHERE company_id=${company}`;
await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES
 (${company},${seller.userId},${seller.email},'sales'),(${company},${manager.userId},${manager.email},'finance_manager')`;
await check('mapping validation checks account kind and journal and audits valid updates',async()=>{
 const view=await ledger.ledgerOverview(fresh(),owner,company,true);
 const bank=view.accounts.find(a=>a.role==='bank'),advance=view.accounts.find(a=>a.role==='customer_advance');
 const journal=view.journals.find(j=>j.kind==='bank'),wrongJournal=view.journals.find(j=>j.kind==='general');
 const invalid=(await ledger.ledgerCreateAccount(fresh(),owner,{company_id:company,entity_id:entity,
  code:'BADADV',name:'Invalid advance classification',kind:'asset',role:'customer_advance'},true)).account;
 const mapping={company_id:company,entity_id:entity,journal_id:journal.id,cash_account_id:bank.id,advance_account_id:advance.id};
 await assert.rejects(()=>finance.configureFinanceMapping(fresh(),owner,{...mapping,advance_account_id:invalid.id},true),e=>e.code==='FINANCE_MAPPING_INVALID');
 await assert.rejects(()=>finance.configureFinanceMapping(fresh(),owner,{...mapping,journal_id:wrongJournal.id},true),e=>e.code==='FINANCE_MAPPING_INVALID');
 const configured=await finance.configureFinanceMapping(fresh(),owner,mapping,true);
 assert.equal(configured.mapping.cash_account_id,bank.id);
 assert.equal((await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${company} AND action='finance.mapping_configured'`)[0].n,1);
});
await check('sales cannot initialize accounts, process, enable or retry finance events',async()=>{
 for(const run of [()=>ledger.initializeAccounting(fresh(),seller,{company_id:company,entity_id:entity,language:'en'}),
  ()=>finance.processFinanceOutbox(fresh(),seller,{company_id:company}),
  ()=>finance.configureFinanceAutomation(fresh(),seller,{company_id:company,enabled:true}),
  ()=>finance.retryFinanceEvent(fresh(),seller,{company_id:company,event_id:eventId})]){
  await assert.rejects(run,e=>e.code==='FORBIDDEN');
 }
});
await check('explicit finance approval denial is enforced by the service',async()=>{
 await raw`INSERT INTO member_permissions(company_id,user_id,action,allowed) VALUES(${company},${manager.userId},'finance.approve',false)`;
 await assert.rejects(()=>finance.configureFinanceAutomation(fresh(),manager,{company_id:company,enabled:true}),e=>e.code==='FORBIDDEN');
 await assert.rejects(()=>finance.processFinanceOutbox(fresh(),manager,{company_id:company}),e=>e.code==='FORBIDDEN');
});
await raw`INSERT INTO finance_events(id,company_id,source_kind,source_id,event_type,processing_kind,amount_minor)
 VALUES(${eventId},${company},'collection',${source},'collection_confirmed','cash_received',10099)`;
await check('two real simultaneous processors produce exactly one posting',async()=>{
 const results=await Promise.all([
  finance.processFinanceOutbox(fresh(),owner,{company_id:company,limit:10},true),
  finance.processFinanceOutbox(fresh(),owner,{company_id:company,limit:10},true)
 ]);
 assert.equal(results.reduce((n,r)=>n+r.result.posted,0),1);
 assert.equal(results.reduce((n,r)=>n+r.result.failed,0),0);
 const [r]=await raw`SELECT count(*)::int n,sum(l.debit_minor)::text debit,sum(l.credit_minor)::text credit
  FROM ledger_entries e JOIN ledger_lines l ON l.entry_id=e.id WHERE e.company_id=${company} AND e.source_id=${source}`;
 assert.deepEqual(r,{n:2,debit:'10099',credit:'10099'});
 assert.equal((await raw`SELECT count(*)::int n FROM finance_event_attempts WHERE event_id=${eventId}`)[0].n,1);
});
await check('repeat batch has no side effects or duplicate audit',async()=>{
 const result=await finance.processFinanceOutbox(fresh(),owner,{company_id:company},true);
 assert.deepEqual(result.result,{posted:0,failed:0});
 assert.equal((await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${company} AND action='finance.event_posted'`)[0].n,1);
});
await check('overview exposes the resulting attempt and empty queue',async()=>{
 const view=await finance.financeEventsOverview(fresh(),owner,company,true);
 assert.deepEqual(view.queue,{waiting:0,retrying:0,blocked:0});
 assert.equal(view.attempts.length,1);assert.equal(view.attempts[0].outcome,'posted');
});
await check('scheduled worker rejects missing credentials without leaking a URL',async()=>{
 await assert.rejects(()=>runFinanceSchedule({}),e=>e.message==='FINANCE_DATABASE_NOT_CONFIGURED');
});
await raw`UPDATE companies SET status='suspended' WHERE id=${company}`;
console.log(JSON.stringify({passed:checks.length,checks,fixture_company:company,fixture_suspended:true},null,2));
