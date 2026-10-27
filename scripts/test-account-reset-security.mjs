import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Execute the real account service and permission resolver with an in-memory SQL
// adapter. This suite never connects to DATABASE_URL or writes external fixtures.
const dir='.sites-runtime/account-reset-security';
fs.mkdirSync(dir,{recursive:true});
for(const name of ['accounts','service','tenant','permissions','passwords']){
 const source=fs.readFileSync(`lib/bunyra/${name}.ts`,'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
  .replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 fs.writeFileSync(`${dir}/${name}.mjs`,js);
}
fs.writeFileSync(`${dir}/sales-targets.mjs`,"import {z} from 'zod';export const targetSchema=z.object({quarter_start:z.string(),currency:z.string(),target_minor:z.string()});");
fs.writeFileSync(`${dir}/subscriptions.mjs`,'export async function requireFeature(){}');
const {resetAccount}=await import(`../${dir}/accounts.mjs`);
const {hashPassword,verifyPassword}=await import(`../${dir}/passwords.mjs`);
const company='11111111-1111-4111-8111-111111111111';
const actor={userId:'operator',email:'operator@example.test'};
const beforePassword='Before audit password 2026!';
const nextPassword='After audit password 2026!';
const originalHash=await hashPassword(beforePassword);
const input={company_id:company,user_id:'target',username:'target',display_name:'Target User',email:'target@example.test',password:nextPassword};
const grant=(action,allowed=true,project_id=null)=>({action,allowed,project_id});
function sqlFor({role='operations',custom=null,overrides=[],targetRole='finance_manager',targetOwner=false,owner=false,missingTarget=false}={}){
 const account={password_hash:originalHash,password_version:1,sessionActive:true};
 const writes=[];
 const sql=(parts,...params)=>{
  const query=parts.join('?');
  return {then(resolve,reject){return Promise.resolve().then(()=>{
   if(query.includes('SELECT user_id FROM platform_owner'))return (params[0]==='target'?targetOwner:owner)?[{user_id:params[0]}]:[];
   if(query.includes('SELECT id FROM companies'))return [{id:company}];
   if(query.includes('SELECT m.role,m.custom_role_id'))return [{role,custom_role_id:custom?'custom-id':null,permissions:custom}];
   if(query.includes('SELECT action,project_id,allowed'))return overrides;
   if(query.includes('SELECT m.role,a.password_hash'))return missingTarget?[]:[{role:targetRole,password_hash:account.password_hash}];
   if(query.includes('WITH target AS')){
    writes.push(query);account.password_hash=params[6];account.password_version++;
    return [{user_id:'target'}];
   }
   if(query.includes('UPDATE app_accounts a SET')){
    writes.push(query);Object.assign(account,{username:params[0],display_name:params[1],email:params[2]});account.password_version++;
    return [{user_id:'target'}];
   }
   if(query.includes('UPDATE memberships')){writes.push(query);return [];}
   if(query.includes('DELETE FROM app_sessions')){writes.push(query);account.sessionActive=false;return [];}
   if(query.includes('INSERT INTO audit_logs')){writes.push(query);return [];}
   throw Error('Unexpected SQL: '+query);
  }).then(resolve,reject);}};
 };
 sql.transaction=async queries=>{sql.beforeTransaction?.();return Promise.all(queries);};
 return {sql,account,writes};
}
const checks=[];
async function check(name,fn){await fn();checks.push(name);}
async function denied(config,error='FORBIDDEN'){
 const state=sqlFor(config);
 await assert.rejects(()=>resetAccount(state.sql,actor,input,config?.owner),e=>e.code===error&&e.status===403);
 assert.deepEqual(state.writes,[]);
 assert.equal(state.account.password_hash,originalHash);
 assert.equal(state.account.sessionActive,true);
}
await check('operations cannot acquire finance manager credentials',()=>denied({targetRole:'finance_manager'}));
await check('operations cannot reset any built-in employee role',async()=>{
 for(const targetRole of ['sales','sales_manager','sales_admin','accountant','operations'])await denied({targetRole});
});
await check('company administrator reset preserves its explicit error',()=>denied({targetRole:'company_admin'},'ADMIN_PASSWORD_FORBIDDEN'));
await check('custom account administrator without members.manage cannot reset credentials',()=>denied({targetRole:'sales',custom:{'accounts.manage':true}}));
await check('custom role cannot inherit members.manage from its company_admin base',()=>denied({role:'company_admin',custom:{'accounts.manage':true}}));
await check('company members.manage deny overrides the administrator role',()=>denied({role:'company_admin',overrides:[grant('members.manage',false)]}));
await check('project-only members.manage grant does not authorize company credentials',()=>denied({overrides:[grant('members.manage',true,'project-1')]}));
await check('operations can still edit account labels without changing credentials',async()=>{
 const state=sqlFor();
 assert.deepEqual(await resetAccount(state.sql,actor,{...input,password:''}),{ok:true});
 assert.equal(state.account.password_hash,originalHash);
 assert.equal(state.account.display_name,input.display_name);
 assert.equal(state.account.password_version,2);
 assert.equal(state.account.sessionActive,false);
});
await check('operations profile access to administrators never writes credentials',async()=>{
 const state=sqlFor({targetRole:'company_admin'});
 await resetAccount(state.sql,actor,{...input,password:''});
 assert.equal(state.account.password_hash,originalHash);
 assert.equal(state.writes.some(q=>q.includes('password_hash')),false);
});
await check('profile-only update cannot restore a stale password after an authorized reset',async()=>{
 const state=sqlFor();const concurrentHash=await hashPassword('Concurrent new password 2026!');
 state.sql.beforeTransaction=()=>{state.account.password_hash=concurrentHash;};
 await resetAccount(state.sql,actor,{...input,password:undefined});
 assert.equal(state.account.password_hash,concurrentHash);
 assert.equal(state.writes.some(q=>q.includes('password_hash')),false);
});
await check('member administrator can reset and revoke prior sessions',async()=>{
 const state=sqlFor({role:'company_admin'});
 assert.deepEqual(await resetAccount(state.sql,actor,input),{ok:true});
 assert.equal(await verifyPassword(nextPassword,state.account.password_hash),true);
 assert.equal(state.account.password_version,2);
 assert.equal(state.account.sessionActive,false);
});
await check('explicit company delegation of members.manage allows reset',async()=>{
 const state=sqlFor({overrides:[grant('members.manage')]});
 await resetAccount(state.sql,actor,input);
 assert.equal(await verifyPassword(nextPassword,state.account.password_hash),true);
});
await check('verified platform owner can manage selected company credentials',async()=>{
 const state=sqlFor({owner:true});
 await resetAccount(state.sql,actor,input,true);
 assert.equal(await verifyPassword(nextPassword,state.account.password_hash),true);
});
await check('company editor can never overwrite platform owner credentials',async()=>{
 const state=sqlFor({owner:true,targetOwner:true});
 await assert.rejects(()=>resetAccount(state.sql,actor,input,true),e=>e.code==='SELF_CHANGE_FORBIDDEN');
 assert.equal(state.writes.every(q=>q.includes('platform_owner.company_access')),true);
 assert.equal(state.account.password_hash,originalHash);
});
console.log(JSON.stringify({passed:checks.length,checks},null,2));
