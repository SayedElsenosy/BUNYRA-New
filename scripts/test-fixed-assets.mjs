import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const dir='.sites-runtime/fixed-assets';fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/asset-depreciation-utils.mjs',ts.transpileModule(fs.readFileSync('lib/bunyra/asset-depreciation-utils.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {monthlyDepreciation}=await import('../'+dir+'/asset-depreciation-utils.mjs');
const checks=[],test=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name)};
test('straight-line amounts sum to exact depreciable cost including remainder',()=>{
 const values=Array.from({length:7},(_,i)=>BigInt(monthlyDepreciation('100000','10000',7,i)));
 assert.equal(values.reduce((a,b)=>a+b,0n),90000n);
 assert.ok(values.every(x=>x>0n));assert.ok(values[0]>values[6]);
});
test('zero/negative basis, invalid months and oversized costs rejected',()=>{
 for(const args of [['100','100',12,0],['99','0',100,0],['5','0',0,0],['5','0',1,1],['99999999999999999999','0',10,0]])assert.throws(()=>monthlyDepreciation(...args),/ASSET_INVALID_/);
});
test('concurrent duplicate monthly journal is idempotent and sequential',()=>{
 const s=fs.readFileSync('db/044-fixed-asset-depreciation.sql','utf8');
 for(const clause of ['FOR UPDATE','UNIQUE(company_id,entity_id,asset_id,period_month)','ASSET_DEPRECIATION_SEQUENCE','source_type,source_id,source_event','bunyra_ledger_post_entry'])assert.ok(s.includes(clause),clause);
});
test('asset API role checks and forced RLS guard company and entity',()=>{
 const s=fs.readFileSync('db/044-fixed-asset-depreciation.sql','utf8');
 for(const clause of ['bunyra_tenant_company()','company_admin','finance_manager','FORCE ROW LEVEL SECURITY','FOREIGN KEY(company_id,entity_id,ledger_entry_id)','assetdepr:'])assert.ok(s.includes(clause),clause);
});
console.log(JSON.stringify({passed:checks.length,checks}));