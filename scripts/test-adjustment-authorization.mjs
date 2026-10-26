import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Real service, access and record-scope code with isolated in-memory SQL/storage.
// No DATABASE_URL, fixture connection or external notification is used.
const dir='.sites-runtime/adjustment-authorization';
fs.mkdirSync(dir,{recursive:true});
for(const name of ['finance-adjustments','service','record-scope','permissions','tenant']){
 const js=ts.transpileModule(fs.readFileSync(`lib/bunyra/${name}.ts`,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}
 }).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 fs.writeFileSync(`${dir}/${name}.mjs`,js);
}
fs.writeFileSync(dir+'/projects.mjs',`export function minorUnits(value){return BigInt(value.replace('.',''))}`);
fs.writeFileSync(dir+'/notifications.mjs',`export async function queueAdjustmentNotification(sql,company,adjustment,event){sql.notifications.push({company,adjustment,event})}`);
const {approveAdjustment,executeAdjustment}=await import('../'+dir+'/finance-adjustments.mjs');
const company='11111111-1111-4111-8111-111111111111';
const project='22222222-2222-4222-8222-222222222222';
const contract='33333333-3333-4333-8333-333333333333';
const adjustment='44444444-4444-4444-8444-444444444444';
const booking='55555555-5555-4555-8555-555555555555';
const input={company_id:company,adjustment_id:adjustment};
const grant=(action,allowed=true,project_id=null)=>({action,allowed,project_id});
function fixture({user='reviewer',role='finance_manager',owner=false,custom=null,overrides=[],row={},missing=false}={}){
 const actor={userId:user,email:user+'@example.test'};
 const state={id:adjustment,company_id:company,contract_id:contract,created_by:'maker',approved_by:null,status:'requested',...row};
 const queries=[],writes=[],notifications=[];
 const sql=(parts,...values)=>{
  const query=parts.join('?');
  return {then(resolve,reject){return Promise.resolve().then(()=>{
   queries.push({query,values});
   if(query.includes('SELECT user_id FROM platform_owner'))return owner?[{user_id:user}]:[];
   if(query.includes('SELECT id FROM companies'))return values[0]===company?[{id:company}]:[];
   if(query.includes('SELECT m.role,m.custom_role_id'))return values[0]===company?[{role,custom_role_id:custom?'custom':null,permissions:custom,subscription_status:'active'}]:[];
   if(query.includes('SELECT action,project_id,allowed'))return overrides;
   if(query.includes('FROM financial_adjustments')&&query.startsWith('SELECT'))return !missing&&values[0]===company&&values[1]===adjustment?[{...state}]:[];
   if(query.includes('SELECT * FROM contracts'))return values[0]===company&&values[1]===contract?[{id:contract,company_id:company,booking_id:booking,project_id:project}]:[];
   if(query.includes('SELECT id FROM projects'))return [{id:project}];
   if(query.includes('SELECT id FROM bookings'))return values[1].includes(project)?[{id:booking}]:[];
   if(query.includes('SELECT * FROM bookings'))return [{id:booking,project_id:project}];
   if(query.startsWith('UPDATE financial_adjustments')){
    writes.push(query);
    if(state.status!=='requested'||state.created_by===values[3])return [];
    Object.assign(state,{status:'approved',approved_by:values[0]});return [{id:adjustment,status:'approved'}];
   }
   if(query.includes('SELECT bunyra_execute_adjustment')){
    writes.push(query);assert.equal(state.status,'approved');
    Object.assign(state,{status:'executed',executed_by:values[2]});return [{result:{id:adjustment,status:'executed'}}];
   }
   if(query.includes('INSERT INTO audit_logs'))return [];
   throw Error('Unexpected SQL: '+query);
  }).then(resolve,reject);}};
 };
 sql.notifications=notifications;
 return {sql,actor,state,queries,writes,notifications,owner};
}
const checks=[];
async function check(name,fn){await fn();checks.push(name)}
async function rejectWithoutMutation(f,action,code,status=403,args=input){
 await assert.rejects(action(f.sql,f.actor,args,f.owner),e=>e.code===code&&e.status===status);
 assert.equal(f.writes.length,0);assert.equal(f.notifications.length,0);
}
await check('requester cannot approve their own adjustment',async()=>{
 const f=fixture({user:'maker'});await rejectWithoutMutation(f,approveAdjustment,'ADJUSTMENT_SELF_APPROVAL');
});
await check('platform owner cannot approve an adjustment they requested',async()=>{
 const f=fixture({user:'maker',owner:true});await rejectWithoutMutation(f,approveAdjustment,'ADJUSTMENT_SELF_APPROVAL');
});
await check('distinct finance reviewer can approve a requested adjustment',async()=>{
 const f=fixture();assert.deepEqual(await approveAdjustment(f.sql,f.actor,input),{id:adjustment,status:'approved'});
 assert.equal(f.state.approved_by,'reviewer');assert.equal(f.notifications[0].event,'approved');
});
await check('approver cannot execute the approved adjustment',async()=>{
 const f=fixture({row:{status:'approved',approved_by:'reviewer'}});
 await rejectWithoutMutation(f,executeAdjustment,'ADJUSTMENT_INDEPENDENT_EXECUTOR');
});
await check('platform owner cannot execute an adjustment they approved',async()=>{
 const f=fixture({owner:true,row:{status:'approved',approved_by:'reviewer'}});
 await rejectWithoutMutation(f,executeAdjustment,'ADJUSTMENT_INDEPENDENT_EXECUTOR');
});
await check('legacy same-person approval cannot execute through a third user',async()=>{
 const f=fixture({user:'executor',row:{status:'approved',approved_by:'maker'}});
 await rejectWithoutMutation(f,executeAdjustment,'ADJUSTMENT_INDEPENDENT_EXECUTOR');
});
await check('missing reviewer cannot execute an approved legacy adjustment',async()=>{
 const f=fixture({row:{status:'approved',approved_by:null}});
 await rejectWithoutMutation(f,executeAdjustment,'ADJUSTMENT_INDEPENDENT_EXECUTOR');
});
await check('original maker may execute after independent approval',async()=>{
 const f=fixture({user:'maker',row:{status:'approved',approved_by:'reviewer'}});
 assert.deepEqual(await executeAdjustment(f.sql,f.actor,input),{id:adjustment,status:'executed'});
 assert.equal(f.state.executed_by,'maker');assert.equal(f.notifications[0].event,'executed');
});
await check('a project denial blocks both approval and execution before mutation',async()=>{
 await rejectWithoutMutation(fixture({overrides:[grant('finance.approve',false,project)]}),approveAdjustment,'FORBIDDEN');
 await rejectWithoutMutation(fixture({overrides:[grant('finance.write',false,project)],row:{status:'approved',approved_by:'other'}}),executeAdjustment,'FORBIDDEN');
});
await check('accountant and restricted custom manager cannot approve',async()=>{
 await rejectWithoutMutation(fixture({role:'accountant'}),approveAdjustment,'FORBIDDEN');
 await rejectWithoutMutation(fixture({custom:{'finance.read':true,'finance.write':true}}),approveAdjustment,'FORBIDDEN');
});
await check('foreign company context is rejected before adjustment read or mutation',async()=>{
 const f=fixture();await rejectWithoutMutation(f,approveAdjustment,'FORBIDDEN',403,{...input,company_id:'66666666-6666-4666-8666-666666666666'});
 assert.equal(f.queries.some(q=>q.query.includes('FROM financial_adjustments')),false);
});
await check('missing adjustment fails without mutation',async()=>{
 await rejectWithoutMutation(fixture({missing:true}),approveAdjustment,'NOT_FOUND',404);
 await rejectWithoutMutation(fixture({missing:true}),executeAdjustment,'INVALID_STATUS',409);
});
await check('approved adjustment cannot be approved again or notified twice',async()=>{
 const f=fixture();await approveAdjustment(f.sql,f.actor,input);
 await assert.rejects(approveAdjustment(f.sql,f.actor,input),e=>e.code==='INVALID_STATUS'&&e.status===409);
 assert.equal(f.notifications.length,1);assert.equal(f.state.approved_by,'reviewer');
});
await check('execution retry after success cannot change balances or send a second notification',async()=>{
 const f=fixture({user:'maker',row:{status:'approved',approved_by:'reviewer'}});
 await executeAdjustment(f.sql,f.actor,input);
 await assert.rejects(executeAdjustment(f.sql,f.actor,input),e=>e.code==='INVALID_STATUS'&&e.status===409);
 assert.equal(f.writes.length,1);assert.equal(f.notifications.length,1);
});
console.log(JSON.stringify({passed:checks.length,checks},null,2));
