import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const dir='.sites-runtime/ledger';
fs.mkdirSync(dir,{recursive:true});
const source=ts.transpileModule(fs.readFileSync('lib/bunyra/ledger-utils.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
fs.writeFileSync(dir+'/ledger-utils.mjs',source);
const {validateLedgerBalance}=await import('../'+dir+'/ledger-utils.mjs');
let passed=0;
function test(name,run){run();passed++;console.log('PASS '+name);}
const line=(d,c)=>({debit_minor:String(d),credit_minor:String(c)});
test('balanced two-sided journal',()=>assert.deepEqual(validateLedgerBalance([line(10000,0),line(0,10000)]),{debit_minor:'10000',credit_minor:'10000'}));
test('three-line split posting',()=>assert.deepEqual(validateLedgerBalance([line(75000,0),line(0,25000),line(0,50000)]),{debit_minor:'75000',credit_minor:'75000'}));
test('exact BigInt beyond Number safe integer',()=>assert.equal(validateLedgerBalance([line('999999999999999999','0'),line('0','999999999999999999')]).debit_minor,'999999999999999999'));
test('unbalanced journal blocked',()=>assert.throws(()=>validateLedgerBalance([line(150,0),line(0,100)]),/LEDGER_UNBALANCED/));
test('single line blocked',()=>assert.throws(()=>validateLedgerBalance([line(500,0)]),/LEDGER_TOO_FEW_LINES/));
test('zero debit/credit blocked',()=>assert.throws(()=>validateLedgerBalance([line(0,0),line(0,100)]),/LEDGER_INVALID_SIDE/));
test('both debit and credit blocked',()=>assert.throws(()=>validateLedgerBalance([line(100,1),line(0,99)]),/LEDGER_INVALID_SIDE/));
test('negative, fractional and oversized amounts blocked',()=>{
 for(const invalid of ['-10','12.30','NaN','1000000000000000000'])assert.throws(()=>validateLedgerBalance([line(invalid,0),line(0,100)]),/LEDGER_INVALID_AMOUNT/);
});
const schema=fs.readFileSync('db/039-ledger-foundation.sql','utf8');
test('tenant isolation on every new ledger table',()=>{
 for(const table of ['ledger_entities','ledger_accounts','ledger_journals','ledger_cost_centers','ledger_entries','ledger_lines'])assert.ok(schema.includes("'"+table+"'"),table);
 assert.match(schema,/ENABLE ROW LEVEL SECURITY/);assert.match(schema,/FORCE ROW LEVEL SECURITY/);assert.match(schema,/bunyra_tenant_company\(\)/);
});
test('posting is guarded and posted journals are immutable',()=>{
 for(const name of ['LEDGER_UNBALANCED','LEDGER_POSTED_IMMUTABLE','LEDGER_FORBIDDEN','bunyra_ledger_post_entry','ledger_lines_account'])assert.ok(schema.includes(name),name);
 assert.match(schema,/UNIQUE\(company_id,entity_id,idempotency_key\)/);
 assert.match(schema,/GRANT EXECUTE ON FUNCTION bunyra_ledger_post_entry\(uuid,uuid\) TO bunyra_tenant/);
});
console.log(JSON.stringify({passed}));
