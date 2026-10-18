import assert from 'node:assert/strict';
import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import * as platform from '../.sites-runtime/tests/platform.mjs';

// Platform-owner console checks. Run only against a dedicated test database.
export async function runPlatformTests(raw){
 const checks=[];async function check(name,fn){await fn();checks.push({name,passed:true});}
 const sql=tenantSql(raw);
 const ownerActor={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
 const owners=await raw`SELECT user_id FROM platform_owner`;
 if(owners.length&&owners[0].user_id!==ownerActor.userId)throw Error('Refusing to run test fixtures in a database with a real platform owner. Use a test database.');
 const a=crypto.randomUUID(),b=crypto.randomUUID(),pa=crypto.randomUUID(),tag=a.slice(0,8);
 const admin={userId:`platform-${tag}-admin`,email:`admin-${tag}@example.com`};
 const hash=()=>crypto.randomUUID().replaceAll('-','').padEnd(64,'0');
 await raw.transaction([
  raw`INSERT INTO platform_owner(singleton,user_id,email) VALUES(true,${ownerActor.userId},${ownerActor.email}) ON CONFLICT DO NOTHING`,
  raw`INSERT INTO companies(id,name) VALUES(${a},${'Platform A '+tag}),(${b},${'Platform B '+tag})`,
  raw`INSERT INTO projects(id,company_id,name) VALUES(${pa},${a},'A project')`,
  raw`INSERT INTO memberships(company_id,user_id,email,role,active) VALUES(${a},${admin.userId},${admin.email},'company_admin',true),(${a},${'platform-'+tag+'-old'},${'old-'+tag+'@example.com'},'sales',false)`,
  raw`INSERT INTO company_settings(company_id,currency) VALUES(${a},'USD')`,
  raw`INSERT INTO organization_nodes(company_id,kind,code,name) VALUES(${a},'branch','CAI','Cairo branch'),(${a},'department','SAL','Sales'),(${b},'branch','ALX','Alex branch')`,
  raw`INSERT INTO inventory_units(company_id,project_id,code,building,floor,category,area,proposed_price_minor,status) VALUES(${a},${pa},'U-1','B1','1','Office',100,1000,'available'),(${a},${pa},'U-2','B1','1','Office',100,1000,'available'),(${a},${pa},'U-3','B1','1','Office',100,1000,'sold')`,
  raw`INSERT INTO invitations(company_id,email,role,token_hash,created_by) VALUES(${a},${'new-'+tag+'@example.com'},'sales',${hash()},${admin.userId})`,
  raw`INSERT INTO invitations(company_id,email,role,token_hash,created_by,expires_at) VALUES(${a},${'late-'+tag+'@example.com'},'sales',${hash()},${admin.userId},now()-interval '1 day')`,
  raw`INSERT INTO audit_logs(company_id,actor_id,actor_email,action) VALUES(${a},${admin.userId},${admin.email},'inventory.updated'),(${b},${admin.userId},${admin.email},'inventory.updated')`,
 ]);
 let view;
 await check('company users cannot open the platform company overview',()=>assert.rejects(()=>platform.companyOverview(sql,admin,a),e=>e.code==='FORBIDDEN'));
 await check('company users cannot read the platform audit log',()=>assert.rejects(()=>platform.platformAudit(sql,admin),e=>e.code==='FORBIDDEN'));
 await check('overview rejects unknown and malformed company ids',async()=>{await assert.rejects(()=>platform.companyOverview(sql,ownerActor,crypto.randomUUID()),e=>e.code==='NOT_FOUND');await assert.rejects(()=>platform.companyOverview(sql,ownerActor,'x'));});
 await check('owner overview returns real company data',async()=>{view=await platform.companyOverview(sql,ownerActor,a);
  assert.equal(view.company.id,a);assert.deepEqual(view.projects.map(p=>[p.id,p.units_count]),[[pa,3]]);assert.equal(view.settings.currency,'USD');
  assert.deepEqual(view.summary,{active_members:1,inactive_members:1,pending_invitations:1,units:{available:2,sold:1}});});
 await check('overview lists only this company branches',()=>assert.deepEqual(view.branches.map(x=>x.code),['CAI']));
 await check('overview activity is company-scoped and hides browsing noise',()=>{assert.deepEqual(view.activity.map(x=>x.action),['inventory.updated']);});
 await check('every overview visit is audited',async()=>{const before=(await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${a} AND action='company.view' AND actor_id=${ownerActor.userId}`)[0].n;await platform.companyOverview(sql,ownerActor,a);assert.equal((await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${a} AND action='company.view' AND actor_id=${ownerActor.userId}`)[0].n,before+1);});
 await check('platform audit can be filtered by company',async()=>{const rows=await platform.platformAudit(sql,ownerActor,{company:b});assert.ok(rows.length>0);assert.ok(rows.every(r=>r.company_id===b));});
 await check('platform audit can hide owner browsing entries',async()=>{const all=await platform.platformAudit(sql,ownerActor,{company:a});const changes=await platform.platformAudit(sql,ownerActor,{company:a,changesOnly:true});assert.ok(all.some(r=>r.action==='company.view'));assert.deepEqual(changes.map(r=>r.action),['inventory.updated']);});
 return {suite:'platform-owner',checks};
}
