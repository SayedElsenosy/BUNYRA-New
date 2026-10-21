import assert from 'node:assert/strict';
import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import * as crm from '../.sites-runtime/tests/crm.mjs';
import * as sales from '../.sites-runtime/tests/sales.mjs';
import * as routing from '../.sites-runtime/tests/lead-routing.mjs';

export async function runLeadRoutingTests(sql){
 const checks=[];
 const test=async(name,run)=>{await run();checks.push({name,passed:true});};
 const company=crypto.randomUUID(),project=crypto.randomUUID(),tag=company.slice(0,8);
 const admin={userId:'route-admin-'+tag,email:'route-admin-'+tag+'@example.com'};
 const manager={userId:'route-manager-'+tag,email:'route-manager-'+tag+'@example.com'};
 const rep1={userId:'route-a-'+tag,email:'route-a-'+tag+'@example.com'};
 const rep2={userId:'route-b-'+tag,email:'route-b-'+tag+'@example.com'};
 await sql`INSERT INTO companies(id,name) VALUES(${company},'Lead routing fixture')`;
 await sql`INSERT INTO projects(id,company_id,name) VALUES(${project},${company},'Routing test project')`;
 await sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${admin.userId},${admin.email},'company_admin'),(${company},${manager.userId},${manager.email},'sales_manager'),(${company},${rep1.userId},${rep1.email},'sales'),(${company},${rep2.userId},${rep2.email},'sales')`;
 const customer=async(name)=>{
  return (await crm.createCustomer(tenantSql(sql),admin,{company_id:company,full_name:name,phone:'+20100'+crypto.randomUUID().replaceAll('-','').slice(0,14)})).id;
 };
 const create=async(customer_id,options={})=>crm.createLead(tenantSql(sql),admin,{company_id:company,customer_id,source:'website',project_id:project,...options});
 let team;
 await test('team exists and routing defaults to disabled',async()=>{
  team=await sales.saveSalesTeam(tenantSql(sql),admin,{company_id:company,name:'Lead team',manager_user_id:manager.userId});
  await sales.addTeamMember(tenantSql(sql),admin,{company_id:company,team_id:team.id,user_id:rep1.userId});
  await sales.addTeamMember(tenantSql(sql),admin,{company_id:company,team_id:team.id,user_id:rep2.userId});
  const config=await routing.getLeadRouting(tenantSql(sql),admin,company);
  assert.equal(config.settings.enabled,false);assert.equal(config.settings.version,0);
  assert.equal(config.teams.find(t=>t.id===team.id).eligible,2);
 });
 let original;
 await test('routing off leaves admin-created leads with admin',async()=>{
  original=await create(await customer('Routing Before Activation'));
  assert.equal(original.owner_user_id,admin.userId);
 });
 await test('sales representatives cannot change global routing settings',async()=>{
  await assert.rejects(()=>routing.saveLeadRouting(tenantSql(sql),rep1,{company_id:company,team_id:team.id,enabled:true,version:0}),/FORBIDDEN/);
 });
 let config;
 await test('admin enables routing with audited versioned update',async()=>{
  config=await routing.saveLeadRouting(tenantSql(sql),admin,{company_id:company,team_id:team.id,enabled:true,version:0});
  assert.equal(config.enabled,true);assert.equal(config.version,1);
 });
 let first,second,third;
 await test('consecutive new leads rotate deterministically',async()=>{
  first=await create(await customer('Round Robin One'));
  second=await create(await customer('Round Robin Two'));
  third=await create(await customer('Round Robin Three'));
  assert.equal(first.owner_user_id,rep1.userId);
  assert.equal(second.owner_user_id,rep2.userId);
  assert.equal(third.owner_user_id,rep1.userId);
 });
 await test('manual owner selection takes precedence',async()=>{
  const explicit=await create(await customer('Manual Owner'),{owner_user_id:rep1.userId});
  assert.equal(explicit.owner_user_id,rep1.userId);
  const fourth=await create(await customer('After Manual'));
  assert.equal(fourth.owner_user_id,rep2.userId);
 });
 await test('rep-created lead stays with its creator',async()=>{
  const id=await customer('Rep Owned Lead');
  const own=await crm.createLead(tenantSql(sql),rep1,{company_id:company,customer_id:id,source:'phone',project_id:project});
  assert.equal(own.owner_user_id,rep1.userId);
 });
 await test('project-specific denial removes a rep from the routing pool',async()=>{
  await sql`INSERT INTO member_permissions(company_id,user_id,project_id,action,allowed) VALUES(${company},${rep1.userId},${project},'leads.read',false)`;
  const next=await create(await customer('Project Safe Routing'));
  assert.equal(next.owner_user_id,rep2.userId);
 });
 await test('stale settings cannot replace current version',async()=>{
  await assert.rejects(()=>routing.saveLeadRouting(tenantSql(sql),admin,{company_id:company,team_id:team.id,enabled:false,version:0}),/VERSION_CONFLICT/);
 });
 await test('turning routing off leaves preexisting ownership unchanged',async()=>{
  config=await routing.saveLeadRouting(tenantSql(sql),admin,{company_id:company,team_id:team.id,enabled:false,version:config.version});
  const disabled=await create(await customer('Routing Disabled'));
  assert.equal(disabled.owner_user_id,admin.userId);
  const rows=await sql`SELECT id,owner_user_id FROM crm_leads WHERE company_id=${company} AND id=ANY(${[first.id,second.id,original.id]}::uuid[])`;
  const owners=new Map(rows.map(r=>[r.id,r.owner_user_id]));
  assert.equal(owners.get(first.id),rep1.userId);
  assert.equal(owners.get(second.id),rep2.userId);
  assert.equal(owners.get(original.id),admin.userId);
 });
 await test('creation and routing changes both have audit history',async()=>{
  const rows=await sql`SELECT action,after_data FROM audit_logs WHERE company_id=${company} AND action IN('crm.lead_created','crm.lead_routing_configured')`;
  assert.ok(rows.filter(r=>r.action==='crm.lead_routing_configured').length>=2);
  assert.ok(rows.some(r=>r.action==='crm.lead_created'&&r.after_data.assignment==='round_robin'));
 });
 return {passed:checks.length,checks,fixture_companies:[company]};
}
