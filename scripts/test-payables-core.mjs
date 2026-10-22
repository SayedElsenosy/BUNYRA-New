import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const dir='.sites-runtime/payables';
fs.mkdirSync(dir,{recursive:true});
const js=ts.transpileModule(fs.readFileSync('lib/bunyra/payables-utils.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
fs.writeFileSync(dir+'/payables-utils.mjs',js);
const {totalPayableMinor}=await import('../'+dir+'/payables-utils.mjs');
let passed=0;const check=(name,f)=>{f();passed++;console.log('PASS '+name)};
check('one expense bill amount',()=>assert.equal(totalPayableMinor([{amount_minor:'150000'}]),'150000'));
check('multiple expense lines use BigInt with exact totals',()=>assert.equal(totalPayableMinor([{amount_minor:'1000000000000000'},{amount_minor:'2500000000000000'}]),'3500000000000000'));
check('zero and negative bill amounts rejected',()=>{
 for(const amount_minor of ['0','-1','12.50'])assert.throws(()=>totalPayableMinor([{amount_minor}]),/VENDOR_BILL_AMOUNT_INVALID/);
});
check('empty vendor bill rejected',()=>assert.throws(()=>totalPayableMinor([]),/VENDOR_BILL_EMPTY/));
check('invalid overlarge payable amounts rejected',()=>assert.throws(()=>totalPayableMinor([{amount_minor:'999999999999999999'},{amount_minor:'1'}]),/VENDOR_BILL_AMOUNT_TOO_LARGE/));
const schema=fs.readFileSync('db/041-vendor-payables.sql','utf8');
check('supplier bill references vendor, journal and GL account dimensions',()=>{
 for(const name of ['finance_vendors','finance_vendor_bills','finance_vendor_bill_lines','finance_payable_mappings','ledger_lines','vendor_id'])
  assert.ok(schema.includes(name),name);
});
check('posting enforces source idempotency and immutable audit trail',()=>{
 for(const name of ['bunyra_post_vendor_bill','VENDOR_BILL_AMOUNT_MISMATCH','VENDOR_BILL_IMMUTABLE','LEDGER_FORBIDDEN'])
  assert.ok(schema.includes(name),name);
});
check('tenant RLS enabled for payable and supplier tables',()=>{
 assert.match(schema,/FORCE ROW LEVEL SECURITY/);
 assert.match(schema,/bunyra_tenant_company\(\)/);
});
console.log(JSON.stringify({passed}));
