import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const raw=neon(process.env.BUNYRA_TEST_DATABASE_URL);
const [{tenantSql},ledger]=await Promise.all([
 import('../.sites-runtime/tests/tenant.mjs'),
 import('../.sites-runtime/tests/ledger.mjs')
]);
const actor={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
const testCompany=crypto.randomUUID(),suffix=testCompany.slice(0,8);
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name)};
const deny=(fn,code)=>assert.rejects(fn,e=>e.code===code||e.message===code);
const fresh=()=>tenantSql(raw);
await check('new company gets a default legal accounting entity',async()=>{
 await raw`INSERT INTO companies(id,name) VALUES(${testCompany},${'Ledger Test '+suffix})`;
 const entities=await raw`SELECT id FROM ledger_entities WHERE company_id=${testCompany} AND code='MAIN' AND is_default`;
 assert.equal(entities.length,1);
});
const entity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${testCompany} AND is_default`)[0].id;
let debitAccount,creditAccount,journal,draft;
await check('authorized owner sets up chart of accounts and journal',async()=>{
 debitAccount=(await ledger.ledgerCreateAccount(fresh(),actor,{company_id:testCompany,entity_id:entity,code:'1100',name:'Test cash',kind:'asset',role:'cash'},true)).account;
 creditAccount=(await ledger.ledgerCreateAccount(fresh(),actor,{company_id:testCompany,entity_id:entity,code:'2200',name:'Customer advances',kind:'liability',role:'customer_advance'},true)).account;
 journal=(await ledger.ledgerCreateJournal(fresh(),actor,{company_id:testCompany,entity_id:entity,code:'GJ',name:'General Journal',kind:'general'},true)).journal;
 const listing=await ledger.ledgerOverview(fresh(),actor,testCompany,true);
 assert.equal(listing.accounts.length,2);assert.equal(listing.journals.length,1);
});
const balanced={company_id:testCompany,entity_id:entity,journal_id:journal.id,
 entry_date:'2026-10-22',reference:'DEMO-100',idempotency_key:'ledger-integration-'+suffix,
 lines:[{account_id:debitAccount.id,debit_minor:'35000',credit_minor:'0'},
        {account_id:creditAccount.id,debit_minor:'0',credit_minor:'35000'}]};
await check('unbalanced drafts rejected before writing',async()=>{
 await deny(()=>ledger.ledgerCreateDraft(fresh(),actor,{...balanced,idempotency_key:'unbalanced-'+suffix,lines:[
  {account_id:debitAccount.id,debit_minor:'200',credit_minor:'0'},
  {account_id:creditAccount.id,debit_minor:'0',credit_minor:'199'}
 ]},true),'LEDGER_UNBALANCED');
});
await check('ledger draft created atomically',async()=>{
 draft=await ledger.ledgerCreateDraft(fresh(),actor,balanced,true);
 assert.equal(draft.state,'draft');assert.equal(draft.created,true);
 const rows=await raw`SELECT count(*)::int n FROM ledger_lines WHERE company_id=${testCompany} AND entry_id=${draft.id}`;
 assert.equal(rows[0].n,2);
});
await check('same idempotency key returns original entry',async()=>{
 const again=await ledger.ledgerCreateDraft(fresh(),actor,balanced,true);
 assert.equal(again.id,draft.id);assert.equal(again.created,false);
 await deny(()=>ledger.ledgerCreateDraft(fresh(),actor,{...balanced,reference:'CHANGED'},true),'LEDGER_IDEMPOTENCY_CONFLICT');
});
await check('posted entry balances and remains immutable',async()=>{
 const result=await ledger.ledgerPost(fresh(),actor,{company_id:testCompany,id:draft.id},true);
 assert.equal(result.state,'posted');
 const data=(await raw`SELECT state,posted_at,posted_by FROM ledger_entries WHERE id=${draft.id}`)[0];
 assert.equal(data.state,'posted');assert.ok(data.posted_at&&data.posted_by);
 await assert.rejects(()=>raw`UPDATE ledger_lines SET debit_minor=debit_minor+1 WHERE entry_id=${draft.id} AND debit_minor>0`,e=>e.message.includes('LEDGER_POSTED_IMMUTABLE'));
 const again=await ledger.ledgerPost(fresh(),actor,{company_id:testCompany,id:draft.id},true);
 assert.equal(again.id,draft.id);
 const logs=await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${testCompany} AND action='ledger.entry_posted'`;
 assert.equal(logs[0].n,1);
});
await check('salesperson cannot access ledger or create entries',async()=>{
 const outsider={userId:'ledger-sales-'+suffix,email:'ledger-sales-'+suffix+'@example.test'};
 await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${testCompany},${outsider.userId},${outsider.email},'sales')`;
 await deny(()=>ledger.ledgerOverview(fresh(),outsider,testCompany),'FORBIDDEN');
 await deny(()=>ledger.ledgerCreateDraft(fresh(),outsider,{...balanced,idempotency_key:'outsider-'+suffix}),'FORBIDDEN');
});
await check('tenant RLS denies foreign-company access to posted ledger',async()=>{
 const foreign=(await raw`SELECT m.company_id::text cid,m.user_id uid FROM memberships m JOIN companies c ON c.id=m.company_id AND c.status='active' WHERE m.company_id<>${testCompany}::uuid AND m.active LIMIT 1`)[0];
 if(!foreign)throw Error('No second tenant fixture');
 const rows=await raw.transaction([
  raw`SET LOCAL ROLE bunyra_tenant`,
  raw`SELECT set_config('app.company_id',${testCompany},true),set_config('app.user_id',${foreign.uid},true)`,
  raw`SELECT count(*)::int AS leaked FROM ledger_entries WHERE company_id=${testCompany}`
 ]);
 assert.equal(rows[2][0].leaked,0);
});
await check('reversing a posted manual journal makes an exact counter-entry',async()=>{
 const controls=await import('../.sites-runtime/tests/ledger-controls.mjs');
 const rev=await controls.reverseLedgerJournal(fresh(),actor,{company_id:testCompany,entry_id:draft.id,date:'2026-10-23',reason:'Verified reversal rehearsal'},true);
 assert.ok(rev.reversed_entry_id);
 const orig=(await raw`SELECT sum(debit_minor)::text debit,sum(credit_minor)::text credit
  FROM ledger_lines WHERE entry_id=${draft.id}`)[0];
 const counterpart=(await raw`SELECT sum(debit_minor)::text debit,sum(credit_minor)::text credit
  FROM ledger_lines WHERE entry_id=${rev.reversed_entry_id}`)[0];
 assert.equal(orig.debit,counterpart.credit);assert.equal(orig.credit,counterpart.debit);
 const repeat=await controls.reverseLedgerJournal(fresh(),actor,{company_id:testCompany,entry_id:draft.id,date:'2026-10-23',reason:'Verified reversal rehearsal'},true);
 assert.equal(repeat.reversed_entry_id,rev.reversed_entry_id);
});
await check('period locks prohibit backdated journal drafts',async()=>{
 const controls=await import('../.sites-runtime/tests/ledger-controls.mjs');
 const lock=await controls.lockLedgerPeriod(fresh(),actor,{company_id:testCompany,entity_id:entity,from:'2026-10-22',to:'2026-10-22',reason:'Validated journal closing'},true);
 assert.equal(lock.status,'locked');
 await deny(()=>ledger.ledgerCreateDraft(fresh(),actor,{...balanced,idempotency_key:'locked-period-'+suffix},true),'LEDGER_PERIOD_LOCKED');
});
console.log(JSON.stringify({passed:checks.length,checks,fixture_company:testCompany},null,2));
