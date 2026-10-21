import assert from 'node:assert/strict';
import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import {workspaceAlerts,readWorkspaceAlert} from '../.sites-runtime/tests/workspace-alerts.mjs';

export async function testWorkspaceAlerts(raw,fixture){
 const owner=(await raw`SELECT user_id FROM platform_owner`)[0]?.user_id;
 assert.equal(owner,'identity-test-platform-owner','DEV test database required');
 const checks=[];
 const check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log('PASS '+name);};
 const fresh=()=>tenantSql(raw);
 const {company}=fixture,tag=company.slice(0,8);
 const sales=(await raw`SELECT user_id,username FROM app_accounts WHERE company_id=${company} AND username=${fixture.ui_username}`)[0];
 const s1={userId:sales.user_id,email:sales.username};
 const s2={userId:'hub-'+tag+'-sales2',email:'sales2-'+tag+'@example.com'};
 const admin={userId:'hub-'+tag+'-admin',email:'admin-'+tag+'@example.com'};
 const finance={userId:'hub-'+tag+'-finance',email:'finance-'+tag+'@example.com'};
 const operations={userId:'hub-'+tag+'-ops',email:'ops-'+tag+'@example.com'};
 const input=(item)=>({company_id:company,kind:item.kind,id:item.id,operation:'read'});
 const deny=(fn,code)=>assert.rejects(fn,e=>e?.code===code||e?.message===code);

 let own,selected;
 await check('Own salesperson alerts include permitted live tasks only',async()=>{
  own=await workspaceAlerts(fresh(),s1,{company});
  assert.ok(own.unread>0);
  assert.equal(own.total,own.unread);
  assert.equal(own.items.length,own.total);
  assert.ok(own.items.every(x=>x.kind==='follow_up'));
  selected=own.items.find(x=>x.kind==='follow_up');
  assert.ok(selected);
 });
 await check('Salespeople cannot see other user alerts or read receipts',async()=>{
  const other=await workspaceAlerts(fresh(),s2,{company});
  assert.ok(!other.items.some(x=>x.id===selected.id));
  await deny(()=>readWorkspaceAlert(fresh(),s2,input(selected)),'WORK_ITEM_UNAVAILABLE');
 });
 await check('Operations and Accounts see only authorized approval/finance tasks',async()=>{
  const ops=await workspaceAlerts(fresh(),operations,{company});
  assert.ok(ops.items.some(x=>x.kind==='booking_approval'));
  assert.ok(!ops.items.some(x=>x.kind==='follow_up'));
  const accounting=await workspaceAlerts(fresh(),finance,{company});
  assert.ok(accounting.items.some(x=>x.kind==='receipt_confirmation'));
  assert.ok(accounting.items.some(x=>x.kind==='installment'));
  assert.ok(!accounting.items.some(x=>x.kind==='follow_up'));
 });
 await check('A read receipt is personal, persisted and does not remove the work',async()=>{
  const acknowledged=await readWorkspaceAlert(fresh(),s1,input(selected));
  assert.equal(acknowledged.kind,selected.kind);
  const again=await workspaceAlerts(fresh(),s1,{company});
  assert.equal(again.total,own.total);
  assert.equal(again.unread,own.unread-1);
  assert.equal(again.items.find(x=>x.id===selected.id).is_read,true);
  const other=await workspaceAlerts(fresh(),s2,{company});
  assert.ok(other.items.every(x=>!x.is_read));
 });
 await check('Unread filter applies before pagination and counts remain full scope',async()=>{
  const one=await workspaceAlerts(fresh(),s1,{company,bucket:'unread'});
  assert.equal(one.filtered_total,one.unread);
  assert.ok(one.items.every(x=>!x.is_read));
 });
 await check('Personal RLS hides another user read receipts even inside one company',async()=>{
  const db=fresh();
  await workspaceAlerts(db,s2,{company});
  const receipt=await db`SELECT user_id FROM workspace_alert_reads WHERE company_id=${company}`;
  assert.equal(receipt.length,0);
  const mine=fresh();await workspaceAlerts(mine,s1,{company});
  const visible=await mine`SELECT user_id FROM workspace_alert_reads WHERE company_id=${company}`;
  assert.ok(visible.length>0&&visible.every(x=>x.user_id===s1.userId));
 });
 await check('Deadline changes regenerate a previously read alert without deleting history',async()=>{
  await raw`UPDATE crm_follow_ups SET due_at=due_at+interval '3 days' WHERE company_id=${company} AND id=${selected.id}`;
  const changed=await workspaceAlerts(fresh(),s1,{company});
  assert.equal(changed.items.find(x=>x.id===selected.id).is_read,false);
  assert.equal(changed.unread,own.unread);
 });
 await check('Cross-company access never leaks alert items or read state',async()=>{
  await deny(()=>workspaceAlerts(fresh(),s1,{company:crypto.randomUUID()}),'FORBIDDEN');
  await deny(()=>readWorkspaceAlert(fresh(),s1,{...input(selected),company_id:crypto.randomUUID()}),'FORBIDDEN');
 });
 await check('Incorrect payloads are rejected instead of altering read receipts',async()=>{
  await assert.rejects(()=>readWorkspaceAlert(fresh(),s1,{...input(selected),operation:'read_everything'}));
  await assert.rejects(()=>workspaceAlerts(fresh(),s1,{company,bucket:'all',page:-1}));
 });
 return {passed:checks.length,checks};
}
