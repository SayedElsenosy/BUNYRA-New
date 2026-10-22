import assert from 'node:assert/strict';
import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import * as crm from '../.sites-runtime/tests/crm.mjs';
import * as sales from '../.sites-runtime/tests/sales.mjs';
import {customerJourney} from '../.sites-runtime/tests/customer-journey.mjs';
import {access} from '../.sites-runtime/tests/service.mjs';
export async function testAssignmentHistory(raw){
assert.equal((await raw`SELECT user_id FROM platform_owner`)[0]?.user_id,'identity-test-platform-owner','Isolated test database required');
const company=crypto.randomUUID(),tag=company.slice(0,8),a={userId:'history-admin-'+tag,email:'admin-'+tag+'@example.test'},r={userId:'history-rep-'+tag,email:'rep-'+tag+'@example.test'},old={userId:'history-old-'+tag,email:'old-'+tag+'@example.test'},manager={userId:'history-manager-'+tag,email:'manager-'+tag+'@example.test'};await raw`INSERT INTO companies(id,name) VALUES(${company},'History visibility QA')`;for(const [u,role]of[[a,'company_admin'],[r,'sales'],[old,'sales'],[manager,'sales_manager']])await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${u.userId},${u.email},${role})`;
const s=()=>tenantSql(raw),c=await crm.createCustomer(s(),a,{company_id:company,full_name:'History QA',phone:'+2010'+tag}),l=await crm.createLead(s(),a,{company_id:company,customer_id:c.id,source:'QA',owner_user_id:old.userId});await crm.addInteraction(s(),a,{company_id:company,customer_id:c.id,lead_id:l.id,kind:'note',body:'PRIVATE OLD ACTIVITY'});await crm.addInteraction(s(),a,{company_id:company,customer_id:c.id,kind:'note',body:'PRIVATE OLD GENERAL NOTE'});const f=await crm.addFollowUp(s(),a,{company_id:company,customer_id:c.id,lead_id:l.id,title:'PRIVATE OLD FOLLOWUP',due_at:new Date(Date.now()+3600000).toISOString(),assigned_to:r.userId});
const team=await sales.saveSalesTeam(s(),manager,{company_id:company,name:'History team',manager_user_id:manager.userId});await sales.addTeamMember(s(),a,{company_id:company,team_id:team.id,user_id:r.userId});
await sales.transferLead(s(),a,{company_id:company,lead_id:l.id,to_user_id:r.userId,hide_previous_history:true});
const checks=[];async function check(name,fn){await fn();checks.push(name);console.log('PASS',name);}
await check('recipient CRM hides previous linked and general interactions and follow-ups',async()=>{const v=await crm.crmOverview(s(),r,company);assert.equal(v.interactions.length,0);assert.equal(v.followUps.length,0);assert.equal(v.customers[0].leads[0].last_action,null);});
await check('customer journey cannot expose previous activity',async()=>{const j=await customerJourney(s(),r,{company,customer:c.id});assert.ok(!j.rows.some(x=>String(x.body).includes('PRIVATE OLD')));});
await check('manager retains complete activity',async()=>{const v=await crm.crmOverview(s(),manager,company);assert.equal(v.interactions.length,2);assert.equal(v.followUps.length,1);});
await check('administrator retains complete activity',async()=>assert.equal((await crm.crmOverview(s(),a,company)).interactions.length,2));
await check('database SELECT and audit history are protected for recipient',async()=>{const sql=s();await access(sql,r,company,'leads.read');assert.equal((await sql`SELECT id FROM crm_interactions WHERE company_id=${company}`).length,0);assert.equal((await sql`SELECT id FROM crm_follow_ups WHERE company_id=${company} AND id=${f.id}`).length,0);assert.equal((await sql`SELECT id FROM audit_logs WHERE company_id=${company} AND action='crm.lead_created'`).length,0);});
await crm.addInteraction(s(),r,{company_id:company,customer_id:c.id,lead_id:l.id,kind:'note',body:'NEW VISIBLE ACTIVITY'});
await check('new activity after transfer is visible',async()=>{const v=await crm.crmOverview(s(),r,company);assert.equal(v.interactions.length,1);assert.equal(v.interactions[0].body,'NEW VISIBLE ACTIVITY');});
await check('platform owner retains complete history',async()=>assert.equal((await crm.crmOverview(s(),{userId:'identity-test-platform-owner',email:'owner@example.test'},company,{asOwner:true})).interactions.length,3));
await check('records are preserved rather than deleted',async()=>assert.equal((await raw`SELECT id FROM crm_interactions WHERE company_id=${company}`).length,3));
await sales.transferLead(s(),a,{company_id:company,lead_id:l.id,to_user_id:r.userId,hide_previous_history:false});await check('unchecked handoff restores full history for its recipient',async()=>assert.equal((await crm.crmOverview(s(),r,company)).interactions.length,3));
return {passed:checks.length,checks};
}
