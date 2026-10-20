import assert from 'node:assert/strict';
import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import {workspaceHub,completeWorkItem} from '../.sites-runtime/tests/workspace-hub.mjs';
import {setPermission} from '../.sites-runtime/tests/service.mjs';
import {createAccount} from '../.sites-runtime/tests/accounts.mjs';
export async function testHubBoundaries(raw,fixture){
 const owner={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
 assert.equal((await raw`SELECT user_id FROM platform_owner`)[0]?.user_id,owner.userId,'DEV database required');
 const checks=[],check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log('PASS '+name);};
 const fresh=()=>tenantSql(raw),{company,project,contract}=fixture,tag=company.slice(0,8);
 const admin={userId:'hub-'+tag+'-admin',email:'admin-'+tag+'@example.com'},finance={userId:'hub-'+tag+'-finance',email:'finance-'+tag+'@example.com'};
 const salesAccount=(await raw`SELECT user_id,username FROM app_accounts WHERE company_id=${company} AND username=${fixture.ui_username}`)[0];
 const sales={userId:salesAccount.user_id,email:salesAccount.username};
 const get=(actor,kind,extra={})=>workspaceHub(fresh(),actor,{company,kind,...extra});
 const projects=await raw`SELECT id FROM projects WHERE company_id=${company}`;
 await check('All-project inventory denial also hides the dashboard action',async()=>{
  try{for(const p of projects)await setPermission(fresh(),admin,{company_id:company,user_id:sales.userId,project_id:p.id,action:'inventory.read',allowed:false});
   const d=await get(sales,'overview');assert.equal(d.capabilities.inventory,false);assert.equal(d.metrics.available_units,0);
  }finally{await setPermission(fresh(),admin,{company_id:company,user_id:sales.userId,project_id:project,action:'inventory.read',allowed:true});}
 });
 await check('Project finance denial removes contract records and collection tasks',async()=>{
  try{await setPermission(fresh(),admin,{company_id:company,user_id:finance.userId,project_id:project,action:'finance.read',allowed:false});
   assert.equal((await get(finance,'overview')).metrics.active_contracts,0);
   assert.ok(!(await get(finance,'tasks')).items.some(x=>x.kind==='installment'));
   await assert.rejects(()=>get(finance,'record',{entity:'contract',id:contract}),e=>e.code==='NOT_FOUND');
  }finally{await setPermission(fresh(),admin,{company_id:company,user_id:finance.userId,project_id:project,action:'finance.read',allowed:true});}
 });
 await check('Financial detail retains exact amount and contract currency snapshot',async()=>{const d=await get(finance,'record',{entity:'contract',id:contract});assert.equal(d.items[0].details.value_minor,'100000');assert.equal(d.items[0].details.currency,'EGP');});
 await check('Installment work labels distinguish installments of the same contract',async()=>{const d=await get(finance,'tasks');const items=d.items.filter(x=>x.kind==='installment');assert.ok(items.length>1);assert.equal(new Set(items.map(x=>x.title)).size,items.length);});
 await check('Record links require an exact entity type',()=>assert.rejects(()=>get(sales,'record',{entity:'all',id:fixture.customer}),e=>e.code==='VALIDATION_ERROR'));
 await check('Out-of-range pages preserve the authorized total and return no rows',async()=>{const d=await get(sales,'search',{q:'Hub QA',entity:'customer',page:10000});assert.equal(d.total,25);assert.equal(d.items.length,0);});
 await check('Search response never includes account hashes or raw permission context',async()=>{const d=await get(admin,'search',{q:'Hub'});const serialized=JSON.stringify(d);for(const value of ['password_hash','password_version','custom_role_id','overrides','DATABASE_URL'])assert.ok(!serialized.includes(value));});
 await check('An unknown task cannot be completed by guessing a record UUID',()=>assert.rejects(()=>completeWorkItem(fresh(),sales,{company_id:company,id:crypto.randomUUID(),operation:'complete_follow_up'}),e=>e.code==='WORK_ITEM_UNAVAILABLE'));
 await check('A stale completed task cannot produce a second audit event',async()=>{const row=(await raw`SELECT id FROM crm_follow_ups WHERE company_id=${company} AND assigned_to=${sales.userId} AND title='Hub QA overdue'`)[0];await assert.rejects(()=>completeWorkItem(fresh(),sales,{company_id:company,id:row.id,operation:'complete_follow_up'}),e=>e.code==='WORK_ITEM_UNAVAILABLE');assert.equal((await raw`SELECT count(*)::int AS n FROM audit_logs WHERE company_id=${company} AND action='crm.follow_up_updated' AND after_data->>'id'=${row.id}`)[0].n,1);});
 await check('Empty search does not disclose a company-wide directory',async()=>{const d=await get(admin,'search',{q:''});assert.equal(d.items.length,0);assert.equal(d.total,0);});
 const username='hub-finance-'+tag;
 if(!(await raw`SELECT user_id FROM app_accounts WHERE username=${username}`).length)await createAccount(fresh(),owner,{company_id:company,username,display_name:'Hub QA Finance',password:'Hub QA fixture password 2026!',email:'',role:'finance_manager'},true);
 return {passed:checks.length,checks,finance_username:username};
}
