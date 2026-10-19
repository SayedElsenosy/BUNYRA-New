import assert from 'node:assert/strict';
import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import * as svc from '../.sites-runtime/tests/service.mjs';
import * as co from '../.sites-runtime/tests/companies.mjs';

// Company lifecycle checks (creation, owner account, requests, deletion). Test database only.
export async function runCompanyTests(raw){
 const checks=[];async function check(name,fn){await fn();checks.push({name,passed:true});}
 const code=c=>e=>e.code===c;
 const sql=tenantSql(raw);
 const ownerActor={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
 const owners=await raw`SELECT user_id FROM platform_owner`;
 if(owners.length&&owners[0].user_id!==ownerActor.userId)throw Error('Refusing to run test fixtures in a database with a real platform owner. Use a test database.');
 await raw`INSERT INTO platform_owner(singleton,user_id,email) VALUES(true,${ownerActor.userId},${ownerActor.email}) ON CONFLICT DO NOTHING`;
 const tag=crypto.randomUUID().slice(0,8);
 const boss={userId:`lifecycle-${tag}-boss`,email:`boss-${tag}@example.com`};
 const stranger={userId:`lifecycle-${tag}-x`,email:`x-${tag}@example.com`};
 let created,company;
 await check('only the platform owner can create companies',()=>assert.rejects(()=>co.createCompany(sql,stranger,{name:'Nope '+tag}),code('FORBIDDEN')));
 await check('creating a company creates settings without external invitations',async()=>{
  created=await co.createCompany(sql,ownerActor,{name:'Lifecycle '+tag,owner_email:boss.email.toUpperCase()});company=created.company;
  assert.equal(created.invite,null);
  assert.equal((await raw`SELECT count(*)::int n FROM company_settings WHERE company_id=${company.id}`)[0].n,1);
  assert.deepEqual((await raw`SELECT role,status FROM invitations WHERE company_id=${company.id}`).map(r=>[r.role,r.status]),[]);});
 await check('existing legacy membership keeps company admin authorization',async()=>{
  await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company.id},${boss.userId},${boss.email},'company_admin')`;
  assert.deepEqual((await raw`SELECT role,active FROM memberships WHERE company_id=${company.id} AND user_id=${boss.userId}`)[0],{role:'company_admin',active:true});
  await svc.access(sql,boss,company.id,'members.manage');});
 await check('company without owner email creates no invitation',async()=>{const r=await co.createCompany(sql,ownerActor,{name:'Solo '+tag});assert.equal(r.invite,null);assert.equal((await raw`SELECT count(*)::int n FROM invitations WHERE company_id=${r.company.id}`)[0].n,0);});
 let req;
 const form={company_name:'Requested '+tag,contact_name:'Req Person',email:`req-${tag}@example.com`,phone:'0100'};
 await check('public registration requests are stored once per pending email',async()=>{req=await co.submitCompanyRequest(raw,form);await assert.rejects(()=>co.submitCompanyRequest(raw,{...form,email:form.email.toUpperCase()}),code('REQUEST_PENDING'));});
 await check('registration requests reject bots and invalid data',async()=>{await assert.rejects(()=>co.submitCompanyRequest(raw,{...form,email:`bot-${tag}@example.com`,website:'spam'}));await assert.rejects(()=>co.submitCompanyRequest(raw,{...form,email:'bad'}));});
 await check('only the platform owner can list and review requests',async()=>{await assert.rejects(()=>co.listCompanyRequests(sql,boss),code('FORBIDDEN'));await assert.rejects(()=>co.reviewCompanyRequest(sql,boss,{id:req.id,version:1,decision:'approve'}),code('FORBIDDEN'));assert.ok((await co.listCompanyRequests(sql,ownerActor)).some(r=>r.id===req.id));});
 await check('approving a request creates the company exactly once without an invitation',async()=>{
  const [a,b]=await Promise.allSettled([co.reviewCompanyRequest(sql,ownerActor,{id:req.id,version:1,decision:'approve'}),co.reviewCompanyRequest(tenantSql(raw),ownerActor,{id:req.id,version:1,decision:'approve'})]);
  const ok=[a,b].filter(x=>x.status==='fulfilled');assert.equal(ok.length,1);
  const r=ok[0].value;assert.equal(r.request.status,'approved');assert.equal(r.request.created_company_id,r.company.id);assert.equal(r.invite,null);
  assert.equal((await raw`SELECT count(*)::int n FROM companies WHERE name=${form.company_name}`)[0].n,1);
  assert.equal((await raw`SELECT count(*)::int n FROM invitations WHERE company_id=${r.company.id} AND role='company_admin' AND status='pending'`)[0].n,0);});
 await check('rejected requests keep the review note and create nothing',async()=>{const r2=await co.submitCompanyRequest(raw,{...form,email:`rej-${tag}@example.com`,company_name:'Rejected '+tag});const out=await co.reviewCompanyRequest(sql,ownerActor,{id:r2.id,version:1,decision:'reject',note:'incomplete'});assert.equal(out.request.status,'rejected');assert.equal(out.request.review_note,'incomplete');assert.equal((await raw`SELECT count(*)::int n FROM companies WHERE name=${'Rejected '+tag}`)[0].n,0);});
 const pid=crypto.randomUUID();
 await raw.transaction([raw`INSERT INTO projects(id,company_id,name) VALUES(${pid},${company.id},'Doomed project')`,raw`INSERT INTO inventory_units(company_id,project_id,code,building,floor,category,area,proposed_price_minor) VALUES(${company.id},${pid},'D-1','B1','1','Office',100,1000)`,raw`INSERT INTO invitations(company_id,email,role,token_hash,created_by) VALUES(${company.id},${'late-'+tag+'@example.com'},'sales',${crypto.randomUUID().replaceAll('-','').padEnd(64,'0')},${boss.userId})`,raw`INSERT INTO organization_nodes(company_id,kind,code,name,manager_user_id) VALUES(${company.id},'branch','HQ','Head office',${boss.userId})`]);
 await check('deletion impact reports the real affected records',async()=>{const i=await co.deletionImpact(sql,ownerActor,company.id);assert.equal(i.counts.projects,1);assert.equal(i.counts.inventory_units,1);assert.equal(i.counts.memberships,1);assert.equal(i.counts.organization_nodes,1);assert.ok(i.counts.audit_logs>0);assert.equal(i.retention_days,30);});
 const v=()=>raw`SELECT version FROM companies WHERE id=${company.id}`.then(r=>r[0].version);
 await check('deletion requires the platform owner and the exact company name',async()=>{await assert.rejects(()=>co.scheduleCompanyDeletion(sql,boss,{id:company.id,version:1,confirm:company.name}),code('FORBIDDEN'));await assert.rejects(async()=>co.scheduleCompanyDeletion(sql,ownerActor,{id:company.id,version:await v(),confirm:'wrong'}),code('CONFIRMATION_MISMATCH'));});
 await check('scheduled deletion closes the company for members and the owner workspace and revokes invitations',async()=>{
  const r=await co.scheduleCompanyDeletion(sql,ownerActor,{id:company.id,version:await v(),confirm:company.name});
  assert.equal(r.company.status,'deleted');assert.equal(r.revoked_invitations,1);
  await assert.rejects(()=>svc.access(sql,boss,company.id,'members.manage'),code('FORBIDDEN'));
  await assert.rejects(()=>svc.access(sql,ownerActor,company.id,'members.manage',true),code('NOT_FOUND'));
  const t=await raw.transaction([raw`SET LOCAL ROLE bunyra_tenant`,raw`SELECT set_config('app.company_id',${company.id},true),set_config('app.user_id',${ownerActor.userId},true)`,raw`SELECT count(*)::int n FROM projects`]);assert.equal(t[2][0].n,0);
  assert.equal((await raw`SELECT count(*)::int n FROM projects WHERE company_id=${company.id}`)[0].n,1);});
 await check('purge is blocked during the retention period',async()=>assert.rejects(async()=>co.purgeCompany(sql,ownerActor,{id:company.id,version:await v(),confirm:company.name}),code('RETENTION_ACTIVE')));
 await check('restore returns the company and its data to its previous state',async()=>{const r=await co.restoreCompany(sql,ownerActor,{id:company.id,version:await v()});assert.equal(r.company.status,'active');await svc.access(sql,boss,company.id,'members.manage');});
 await check('purge after retention removes business data but keeps the audit trail',async()=>{
  await co.scheduleCompanyDeletion(sql,ownerActor,{id:company.id,version:await v(),confirm:company.name});
  await raw`UPDATE companies SET purge_after=now()-interval '1 minute' WHERE id=${company.id}`;
  await raw`INSERT INTO project_plan_files(company_id,project_id,title,building,floor,kind,original_name,object_key,byte_size,sha256,version,status,created_by) VALUES(${company.id},${pid},'Purge fixture','B1','1','pdf','test.pdf',${company.id+'/test.pdf'},100,'test',1,'ready',${boss.userId})`;
  const auditBefore=(await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${company.id}`)[0].n;
  const r=await co.purgeCompany(sql,ownerActor,{id:company.id,version:await v(),confirm:company.name},{remove:async()=>{throw Error('temporary storage failure')}});
  assert.equal(r.files_failed,1);
  assert.equal(r.purged.projects,1);
  for(const t of ['projects','inventory_units','memberships','invitations','organization_nodes','company_settings'])assert.equal((await raw.query(`SELECT count(*)::int n FROM ${t} WHERE company_id=$1`,[company.id]))[0].n,0,t);
  assert.equal((await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${company.id}`)[0].n,auditBefore+2);
  const row=(await raw`SELECT status,purged_at,email FROM companies WHERE id=${company.id}`)[0];assert.equal(row.status,'deleted');assert.ok(row.purged_at);assert.equal(row.email,'');});
 await check('a purged company cannot be restored or purged again',async()=>{await assert.rejects(async()=>co.restoreCompany(sql,ownerActor,{id:company.id,version:await v()}),code('VERSION_CONFLICT'));await assert.rejects(async()=>co.purgeCompany(sql,ownerActor,{id:company.id,version:await v(),confirm:company.name}),code('NOT_SCHEDULED'));});
 await check('lifecycle actions are audited',async()=>{const acts=(await raw`SELECT action FROM audit_logs WHERE company_id=${company.id} ORDER BY id`).map(r=>r.action);for(const a of ['company.created','company.deletion_scheduled','company.restored','company.purged'])assert.ok(acts.includes(a),a);});
 await check('storage cleanup survives failure and retries without restoring business records',async()=>{
  const input={id:company.id,version:await v(),confirm:company.name};
  await assert.rejects(()=>co.retryCompanyStorage(sql,stranger,input,{remove:async()=>{}}),code('FORBIDDEN'));
  await assert.rejects(()=>co.retryCompanyStorage(sql,ownerActor,{...input,confirm:'wrong'},{remove:async()=>{}}),code('CONFIRMATION_MISMATCH'));
  const failed=await co.retryCompanyStorage(sql,ownerActor,input,{remove:async()=>{throw Error('temporary storage outage')}});
  assert.equal(failed.files_failed,1);
  assert.equal((await raw`SELECT attempts FROM storage_cleanup_jobs WHERE company_id=${company.id}`)[0].attempts,2);
  const removed=[];const retried=await co.retryCompanyStorage(sql,ownerActor,input,{remove:async key=>removed.push(key)});
  assert.equal(retried.files_failed,0);assert.equal(removed.length,1);
  await co.retryCompanyStorage(sql,ownerActor,input,{remove:async()=>{throw Error('must not run')}});
  assert.equal((await co.deletionImpact(sql,ownerActor,company.id)).counts.projects,0);
 });
 return {suite:'company-lifecycle',checks};
}
