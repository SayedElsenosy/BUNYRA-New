import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const raw=neon(process.env.BUNYRA_TEST_DATABASE_URL);
if(!(await raw`SELECT version FROM schema_migrations WHERE version='042-bank-reconciliation'`).length)
 throw Error('Apply reviewed migration 042 to isolated dev-foundation first');
const [{tenantSql},ledger,treasury]=await Promise.all([
 import('../.sites-runtime/tests/tenant.mjs'),
 import('../.sites-runtime/tests/ledger.mjs'),
 import('../.sites-runtime/tests/treasury.mjs')
]);
const actor={userId:'identity-test-platform-owner',email:'platform-test@example.com'},fresh=()=>tenantSql(raw);
const company=crypto.randomUUID(),part=company.slice(0,8);
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name)};
const deny=(fn,code)=>assert.rejects(fn,e=>e.code===code||e.message===code);
await check('statement import guard can lock without granting tenant statement updates',async()=>{
 const [privileges]=await raw`SELECT has_table_privilege('bunyra_tenant','treasury_bank_statements','UPDATE') AS can_update,
  p.prosecdef AS protected_guard FROM pg_proc p WHERE p.oid='bunyra_bank_line_open()'::regprocedure`;
 assert.equal(privileges.can_update,false);
 assert.equal(privileges.protected_guard,true);
});
await raw`INSERT INTO companies(id,name) VALUES(${company},${'Treasury Tests '+part})`;
const entity=(await raw`SELECT id FROM ledger_entities WHERE company_id=${company} AND is_default`)[0].id;
let account,journal,entry,stmt,bankLine;
await check('create bank and customer advances ledger accounts',async()=>{
 account=(await ledger.ledgerCreateAccount(fresh(),actor,{company_id:company,entity_id:entity,code:'1200',name:'Bank current account',kind:'asset',role:'bank',reconcilable:true},true)).account;
 const liability=(await ledger.ledgerCreateAccount(fresh(),actor,{company_id:company,entity_id:entity,code:'2200',name:'Customer advances',kind:'liability',role:'customer_advance'},true)).account;
 journal=(await ledger.ledgerCreateJournal(fresh(),actor,{company_id:company,entity_id:entity,code:'BNK',name:'Bank journal',kind:'bank'},true)).journal;
 const data=await ledger.ledgerCreateDraft(fresh(),actor,{
  company_id:company,entity_id:entity,journal_id:journal.id,entry_date:'2026-10-22',
  reference:'TREASURY-DEMO-001',idempotency_key:'treasury-ledger-'+part,
  lines:[{account_id:account.id,debit_minor:'12500',credit_minor:'0'},
    {account_id:liability.id,debit_minor:'0',credit_minor:'12500'}]
 },true);
 entry=await ledger.ledgerPost(fresh(),actor,{company_id:company,id:data.id},true);
});
await check('import external bank statement and a deposit',async()=>{
 stmt=(await treasury.createBankStatement(fresh(),actor,{company_id:company,entity_id:entity,
  bank_account_id:account.id,statement_ref:'BANK-202610',date_from:'2026-10-01',
  date_to:'2026-10-31',opening_minor:'0',closing_minor:'12500'},true)).statement;
 const loaded=await treasury.importBankLines(fresh(),actor,{company_id:company,statement_id:stmt.id,
  lines:[{external_ref:'TXN-1',booked_on:'2026-10-22',signed_minor:'12500',description:'Customer advance'}]
 },true);
 assert.equal(loaded.imported.length,1);bankLine=loaded.imported[0];
});
const bankJournalLine=(await raw`SELECT id FROM ledger_lines WHERE entry_id=${entry.id}
 AND account_id=${account.id} AND debit_minor=12500`)[0].id;
await check('bank deposit can be matched only to equivalent posted GL line',async()=>{
 const matched=await treasury.reconcileBankLine(fresh(),actor,{company_id:company,
  bank_line_id:bankLine.id,ledger_line_id:bankJournalLine},true);
 assert.equal(matched.state,'matched');
 const retry=await treasury.reconcileBankLine(fresh(),actor,{company_id:company,
  bank_line_id:bankLine.id,ledger_line_id:bankJournalLine},true);
 assert.equal(retry.match_id,matched.match_id);
});
await check('fully reconciled bank statement closes with exact balances',async()=>{
 const closed=await treasury.closeBankStatement(fresh(),actor,{company_id:company,statement_id:stmt.id},true);
 assert.equal(closed.status,'closed');
 const current=(await raw`SELECT status FROM treasury_bank_statements WHERE id=${stmt.id}`)[0].status;
 assert.equal(current,'closed');
});
await check('closed bank statement cannot accept more lines',async()=>{
 await deny(()=>treasury.importBankLines(fresh(),actor,{company_id:company,statement_id:stmt.id,
  lines:[{external_ref:'TXN-2',booked_on:'2026-10-23',signed_minor:'500'}]},true),'TREASURY_STATEMENT_CLOSED');
});
await check('sales user has no access to bank transaction records',async()=>{
 const other={userId:'treasury-sales-'+part,email:'treasury-sales-'+part+'@example.test'};
 await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${other.userId},${other.email},'sales')`;
 await deny(()=>treasury.treasuryOverview(fresh(),other,company),'FORBIDDEN');
});
console.log(JSON.stringify({passed:checks.length,checks,fixture_company:company},null,2));
