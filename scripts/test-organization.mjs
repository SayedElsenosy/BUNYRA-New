import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import assert from 'node:assert/strict';
import * as org from '../.sites-runtime/tests/organization.mjs';
// Creates uniquely named fixtures only on an explicitly selected isolated test branch.
export async function runOrganizationTests(sql){
 const checks=[];async function check(name,fn){await fn();checks.push({name,passed:true});}
 const a=crypto.randomUUID(),b=crypto.randomUUID(),suffix=a.slice(0,8);
 const admin={userId:'org-admin-'+suffix,email:'org-admin-'+suffix+'@example.com'},sales={userId:'org-sales-'+suffix,email:'org-sales-'+suffix+'@example.com'};
 await sql`INSERT INTO companies(id,name) VALUES(${a},'Organization test A'),(${b},'Organization test B')`;
 await sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${a},${admin.userId},${admin.email},'company_admin'),(${a},${sales.userId},${sales.email},'sales')`;
 const deny=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 const node=(kind,code,more={})=>({company_id:a,kind,code,name:'Test '+code,name_en:'Test '+code,parent_id:null,manager_user_id:null,active:true,...more});
 const settings={company_id:a,version:0,company_version:1,name:'Organization test A',name_en:'Test A',email:'',phone:'',address:'',logo_url:'',currency:'EGP',time_zone:'Africa/Cairo',locale:'ar'};
 await check('sales reads organization without staff directory',async()=>{const d=await org.organization(tenantSql(sql),sales,a);assert.equal(d.capabilities.write,false);assert.equal(d.members.length,0);});
 await check('cross-company reads denied',()=>deny(()=>org.organization(tenantSql(sql),admin,b),'FORBIDDEN'));
 await check('forged platform mode denied',()=>deny(()=>org.organization(tenantSql(sql),admin,b,true),'FORBIDDEN'));
 await check('sales cannot change company settings',()=>deny(()=>org.saveSettings(tenantSql(sql),sales,settings),'FORBIDDEN'));
 await check('settings and company data save atomically',async()=>{await org.saveSettings(tenantSql(sql),admin,settings);const d=await org.organization(tenantSql(sql),admin,a);assert.equal(d.settings.version,1);assert.equal(d.company.version,2);});
 await check('stale settings version denied',()=>deny(()=>org.saveSettings(tenantSql(sql),admin,settings),'VERSION_CONFLICT'));
 await check('invalid time zone rejected',()=>assert.rejects(()=>org.saveSettings(tenantSql(sql),admin,{...settings,time_zone:'Invalid/Zone'})));
 await check('unsafe logo URL rejected',()=>assert.rejects(()=>org.saveSettings(tenantSql(sql),admin,{...settings,logo_url:'javascript:alert(1)'})));
 let branch,department,team,legal,cost;
 await check('create branch',async()=>{branch=await org.saveNode(tenantSql(sql),admin,node('branch','BR'));});
 await check('create department under branch',async()=>{department=await org.saveNode(tenantSql(sql),admin,node('department','DEP',{parent_id:branch.id}));});
 await check('create team with active manager',async()=>{team=await org.saveNode(tenantSql(sql),admin,node('team','TEAM',{parent_id:department.id,manager_user_id:admin.userId}));});
 await check('legal entity and cost center',async()=>{legal=await org.saveNode(tenantSql(sql),admin,node('legal_entity','LEGAL'));cost=await org.saveNode(tenantSql(sql),admin,node('cost_center','COST',{parent_id:legal.id}));});
 await check('invalid parent kind denied by database',()=>deny(()=>org.saveNode(tenantSql(sql),admin,node('team','BAD',{parent_id:branch.id})),'23514'));
 await check('duplicate organization code denied',()=>deny(()=>org.saveNode(tenantSql(sql),admin,node('branch','BR')),'23505'));
 const otherBranch=crypto.randomUUID();await sql`INSERT INTO organization_nodes(id,company_id,kind,code,name) VALUES(${otherBranch},${b},'branch','OTHER','Other branch')`;
 await check('cross-company parent denied',()=>assert.rejects(()=>org.saveNode(tenantSql(sql),admin,node('department','CROSS',{parent_id:otherBranch}))));
 await check('cross-company manager denied',()=>assert.rejects(()=>org.saveNode(tenantSql(sql),admin,node('team','MGR',{manager_user_id:'unknown-user'}))));
 await check('sales cannot create nodes',()=>deny(()=>org.saveNode(tenantSql(sql),sales,node('branch','NO')),'FORBIDDEN'));
 await check('parent with active children cannot be stopped',()=>deny(()=>org.saveNode(tenantSql(sql),admin,node('branch','BR',{id:branch.id,version:1,active:false})),'23514'));
 let placement;
 await check('assign member to team',async()=>{placement=await org.savePlacement(tenantSql(sql),admin,{company_id:a,user_id:sales.userId,node_id:team.id,project_id:null,active:true});});
 await check('organization assignment does not grant permissions',()=>deny(()=>org.saveNode(tenantSql(sql),sales,node('branch','STILL_NO')),'FORBIDDEN'));
 await check('cannot stop node with active assignments',()=>deny(()=>org.saveNode(tenantSql(sql),admin,node('team','TEAM',{id:team.id,version:1,parent_id:department.id,active:false})),'23514'));
 await check('cross-company member assignment denied',()=>assert.rejects(()=>org.savePlacement(tenantSql(sql),admin,{company_id:a,user_id:sales.userId,node_id:otherBranch,project_id:null,active:true})));
 await check('assignment deactivation and stale version conflict',async()=>{const p={...placement,company_id:a,user_id:sales.userId,node_id:team.id,project_id:null,version:1,active:false};await org.savePlacement(tenantSql(sql),admin,p);await deny(()=>org.savePlacement(tenantSql(sql),admin,p),'VERSION_CONFLICT');});
 await check('node can be stopped after assignments stopped',async()=>{await org.saveNode(tenantSql(sql),admin,node('team','TEAM',{id:team.id,version:1,parent_id:department.id,active:false}));});
 await check('inactive node rejects new active assignment',()=>deny(()=>org.savePlacement(tenantSql(sql),admin,{company_id:a,user_id:admin.userId,node_id:team.id,active:true}),'23514'));
 await check('tenant SQL role cannot read other company organization',async()=>{const r=await sql.transaction([sql`SET LOCAL ROLE bunyra_tenant`,sql`SELECT set_config('app.company_id',${a},true),set_config('app.user_id',${admin.userId},true)`,sql`SELECT count(*)::int AS count FROM organization_nodes WHERE company_id=${b}`]);assert.equal(r[2][0].count,0);});
 await check('tenant without membership sees no organization',async()=>{const r=await sql.transaction([sql`SET LOCAL ROLE bunyra_tenant`,sql`SELECT set_config('app.company_id',${a},true),set_config('app.user_id','no-such-member',true)`,sql`SELECT count(*)::int AS count FROM organization_nodes`]);assert.equal(r[2][0].count,0);});
 await check('settings nodes and assignments have audit evidence',async()=>{const rows=await sql`SELECT DISTINCT action FROM audit_logs WHERE company_id=${a}`;for(const action of ['company.settings_updated','organization.created','organization.updated','placement.created','placement.updated'])assert.ok(rows.some(r=>r.action===action));});
 return {passed:checks.length,checks,fixture_company_ids:[a,b]};
}
