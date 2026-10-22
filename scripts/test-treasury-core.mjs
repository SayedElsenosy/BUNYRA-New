import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const dir='.sites-runtime/treasury';fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/treasury-utils.mjs',ts.transpileModule(fs.readFileSync('lib/bunyra/treasury-utils.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
const {assertBankStatementBalance}=await import('../'+dir+'/treasury-utils.mjs');
let passed=0;const check=(n,f)=>{f();passed++;console.log('PASS '+n)};
check('bank statement reconciles exact cash movements',()=>assert.equal(assertBankStatementBalance('10000','12500',['-500','3000']),'12500'));
check('negative closing balances are supported',()=>assert.equal(assertBankStatementBalance('0','-100',['-100']),'-100'));
check('incorrect bank closing balance is blocked',()=>assert.throws(()=>assertBankStatementBalance('0','100',['99']),/TREASURY_BALANCE_MISMATCH/));
check('amount parsing never uses floating-point',()=>assert.equal(assertBankStatementBalance('9007199254740992','9007199254740993',['1']),'9007199254740993'));
check('fractional or malformed balance is rejected',()=>assert.throws(()=>assertBankStatementBalance('1.00','2',['1']),/TREASURY_INVALID_AMOUNT/));
const sql=fs.readFileSync('db/042-bank-reconciliation.sql','utf8');
check('bank match verifies equal posted GL movement and bank account',()=>{
 for(const term of ['bunyra_bank_match','TREASURY_AMOUNT_MISMATCH','TREASURY_NOT_POSTED','ledger_line_id'])assert.ok(sql.includes(term));
});
check('statement line inserts serialize with bank closing',()=>{
 assert.match(sql,/treasury_line_only_when_open/);assert.match(sql,/FOR SHARE OF s/);
});
check('tenant RLS and protected reconciliation functions are present',()=>{
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION bunyra_bank_match/);
 assert.match(sql,/bunyra_tenant_company\(\)/);
});
console.log(JSON.stringify({passed}));
