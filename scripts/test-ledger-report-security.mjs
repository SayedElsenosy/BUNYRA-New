import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Exercise the real report, access() and permission policy without connecting
// to a database. Each fake query fails closed unless explicitly handled below.
const dir='.sites-runtime/ledger-report-security';
fs.mkdirSync(dir,{recursive:true});
for(const name of ['tenant','permissions','service','ledger-report-utils','ledger-reports']){
 const output=ts.transpileModule(fs.readFileSync(`lib/bunyra/${name}.ts`,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}
 }).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 fs.writeFileSync(`${dir}/${name}.mjs`,output);
}
const {ledgerFinancialReport}=await import(`../${dir}/ledger-reports.mjs`);
const company='11111111-1111-4111-8111-111111111111';
const entity='22222222-2222-4222-8222-222222222222';
const permittedProject='33333333-3333-4333-8333-333333333333';
const deniedProject='44444444-4444-4444-8444-444444444444';
const foreignProject='55555555-5555-4555-8555-555555555555';
const actor={userId:'finance-reader',email:'reader@example.test'};
const base={company_id:company,entity_id:entity,from:'2026-01-01',to:'2026-10-27',project_id:null};
const denyProject={action:'finance.read',project_id:deniedProject,allowed:false};
function sqlFor({role='finance_manager',custom=null,overrides=[],owner=false,active=true,entityExists=true}={}){
 const calls=[];
 const sql=(parts,...params)=>{
  const query=parts.join('?');calls.push({query,params});
  if(query.includes('SELECT id FROM projects WHERE company_id=')){
   assert.equal(params[0],company);
   return Promise.resolve([permittedProject,deniedProject].includes(params[1])?[{id:params[1]}]:[]);
  }
  if(query.includes('SELECT m.role,m.custom_role_id'))return Promise.resolve(active?[{
   role,custom_role_id:custom?'custom-finance-role':null,permissions:custom
  }]:[]);
  if(query.includes('SELECT action,project_id,allowed'))return Promise.resolve(overrides);
  if(query.includes('SELECT user_id FROM platform_owner'))return Promise.resolve(owner?[{user_id:actor.userId}]:[]);
  if(query.includes('SELECT id FROM companies'))return Promise.resolve([{id:company}]);
  if(query.includes('INSERT INTO audit_logs'))return Promise.resolve([]);
  if(query.includes('SELECT id FROM ledger_entities')){
   assert.deepEqual(params,[company,entity]);return Promise.resolve(entityExists?[{id:entity}]:[]);
  }
  if(query.includes('FROM ledger_entries e')){
   assert.equal(params[0],company);assert.equal(params[1],entity);
   const project=params.at(-1);
   assert.equal(params.at(-2),project,'both halves of project predicate use the same binding');
   if(query.includes('SELECT l.project_id,p.name AS project_name'))return Promise.resolve([
    {project_id:project??deniedProject,project_name:project===permittedProject?'Permitted':'Restricted'}
   ]);
   return Promise.resolve([]);
  }
  throw Error('Unhandled test query: '+query);
 };
 sql.calls=calls;
 sql.financialReads=()=>calls.filter(c=>c.query.includes('FROM ledger_entries e'));
 return sql;
}
const checks=[];
async function check(name,run){await run();checks.push(name);}
const forbidden=error=>error.code==='FORBIDDEN'&&error.status===403;

await check('A project denial blocks a null-project report before financial reads',async()=>{
 const sql=sqlFor({overrides:[denyProject]});
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,base),forbidden);
 assert.equal(sql.financialReads().length,0);
});
await check('Omitting project_id cannot bypass the same denial',async()=>{
 const sql=sqlFor({overrides:[denyProject]});const {project_id,...input}=base;
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,input),forbidden);
 assert.equal(sql.financialReads().length,0);
});
await check('An explicitly denied project is rejected by the real access policy',async()=>{
 const sql=sqlFor({overrides:[denyProject]});
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,{...base,project_id:deniedProject}),forbidden);
 assert.equal(sql.financialReads().length,0);
});
await check('A permitted project still works and scopes all three queries and analytics',async()=>{
 const sql=sqlFor({overrides:[denyProject]});
 const result=await ledgerFinancialReport(sql,actor,{...base,project_id:permittedProject});
 assert.equal(sql.financialReads().length,3);
 assert.ok(sql.financialReads().every(c=>c.params.at(-1)===permittedProject));
 assert.deepEqual(result.project_analytics.map(p=>p.project_id),[permittedProject]);
});
await check('Unrestricted finance managers can still request complete financial statements',async()=>{
 const sql=sqlFor();const result=await ledgerFinancialReport(sql,actor,base);
 assert.equal(result.project_id,null);assert.equal(sql.financialReads().length,3);
});
await check('Unrelated project permission denials do not block financial reports',async()=>{
 const sql=sqlFor({overrides:[{...denyProject,action:'inventory.read'}]});
 await ledgerFinancialReport(sql,actor,base);assert.equal(sql.financialReads().length,3);
});
await check('Company-level finance denial rejects the aggregate report',async()=>{
 const sql=sqlFor({overrides:[{action:'finance.read',project_id:null,allowed:false}]});
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,base),forbidden);
 assert.equal(sql.financialReads().length,0);
});
await check('A custom role cannot inherit finance.read from finance_manager',async()=>{
 const sql=sqlFor({custom:{'company.read':true}});
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,base),forbidden);
 assert.equal(sql.financialReads().length,0);
});
await check('A custom finance reader remains subject to project denials',async()=>{
 const sql=sqlFor({custom:{'finance.read':true},overrides:[denyProject]});
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,base),forbidden);
 await ledgerFinancialReport(sql,actor,{...base,project_id:permittedProject});
 assert.equal(sql.financialReads().length,3);
});
await check('A company administrator cannot bypass an explicit project denial',async()=>{
 const sql=sqlFor({role:'company_admin',overrides:[denyProject]});
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,base),forbidden);
 assert.equal(sql.financialReads().length,0);
});
await check('Scoped accountants do not gain full-ledger report access',async()=>{
 const sql=sqlFor({role:'accountant',overrides:[{action:'finance.read',project_id:permittedProject,allowed:true}]});
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,{...base,project_id:permittedProject}),forbidden);
 assert.equal(sql.financialReads().length,0);
});
await check('Unverified platform mode does not bypass membership or project restrictions',async()=>{
 const sql=sqlFor({overrides:[denyProject]});
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,base,true),forbidden);
 assert.equal(sql.financialReads().length,0);
});
await check('Verified platform owner retains audited full-company access',async()=>{
 const sql=sqlFor({owner:true,overrides:[denyProject]});
 await ledgerFinancialReport(sql,actor,base,true);
 assert.equal(sql.financialReads().length,3);
 assert.ok(sql.calls.some(c=>c.query.includes('INSERT INTO audit_logs')));
});
await check('Foreign or missing projects cannot be used as a report scope',async()=>{
 const sql=sqlFor();
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,{...base,project_id:foreignProject}),e=>e.code==='INVALID_PROJECT');
 assert.equal(sql.financialReads().length,0);
});
await check('An inactive member never reaches report data',async()=>{
 const sql=sqlFor({active:false});
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,base),forbidden);
 assert.equal(sql.financialReads().length,0);
});
await check('A foreign or missing entity never reaches report data',async()=>{
 const sql=sqlFor({entityExists:false});
 await assert.rejects(()=>ledgerFinancialReport(sql,actor,base),e=>e.code==='NOT_FOUND');
 assert.equal(sql.financialReads().length,0);
});
console.log(JSON.stringify({passed:checks.length,checks},null,2));
