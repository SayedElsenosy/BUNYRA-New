import assert from 'node:assert/strict';
import {tenantSql,bindTenant} from '../.sites-runtime/tests/tenant.mjs';
import * as svc from '../.sites-runtime/tests/service.mjs';
import * as inv from '../.sites-runtime/tests/inventory.mjs';
import * as proj from '../.sites-runtime/tests/projects.mjs';

// Database-level isolation checks. Run only against a dedicated test database:
// creates isolated fixtures and never touches existing business records.
export async function runTenancyTests(sql){
 const checks=[];async function check(name,fn){await fn();checks.push({name,passed:true});}
 const reject=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 const platform={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
 const owners=await sql`SELECT user_id FROM platform_owner`;
 if(owners.length&&owners[0].user_id!==platform.userId)throw Error('Refusing to run test fixtures in a database with a real platform owner. Use a test database.');
 const a=crypto.randomUUID(),b=crypto.randomUUID(),s=crypto.randomUUID(),pa=crypto.randomUUID(),pb=crypto.randomUUID(),ps=crypto.randomUUID(),tag=a.slice(0,8);
 const who=t=>({userId:`tenancy-${tag}-${t}`,email:`${t}-${tag}@example.com`});
 const adminA=who('admin-a'),salesA=who('sales-a'),adminB=who('admin-b'),memberS=who('member-s'),formerA=who('former-a');
 await sql.transaction([
  sql`INSERT INTO platform_owner(singleton,user_id,email) VALUES(true,${platform.userId},${platform.email}) ON CONFLICT DO NOTHING`,
  sql`INSERT INTO companies(id,name) VALUES(${a},${'Tenancy A '+tag}),(${b},${'Tenancy B '+tag})`,
  sql`INSERT INTO companies(id,name,status) VALUES(${s},${'Tenancy Suspended '+tag},'suspended')`,
  sql`INSERT INTO projects(id,company_id,name) VALUES(${pa},${a},'A project'),(${pb},${b},'B project'),(${ps},${s},'S project')`,
  sql`INSERT INTO memberships(company_id,user_id,email,role,active) VALUES(${a},${adminA.userId},${adminA.email},'company_admin',true),(${a},${salesA.userId},${salesA.email},'sales',true),(${a},${formerA.userId},${formerA.email},'sales',false),(${b},${adminB.userId},${adminB.email},'company_admin',true),(${s},${memberS.userId},${memberS.email},'company_admin',true)`,
  sql`INSERT INTO inventory_units(company_id,project_id,code,building,floor,category,area,proposed_price_minor) VALUES(${a},${pa},'A-1','B1','1','Office',100,1000),(${a},${pa},'A-2','B1','1','Office',100,1000),(${b},${pb},'B-1','B1','1','Office',100,1000),(${s},${ps},'S-1','B1','1','Office',100,1000)`,
  sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action) VALUES(${a},'fixture','fixture@example.com','fixture.a'),(${b},'fixture','fixture@example.com','fixture.b')`]);
 const scoped=(company,actor)=>{const t=tenantSql(sql);bindTenant(t,company,actor.userId);return t;};
 const ids=rows=>rows.map(r=>r.company_id??r.id);

 await check('unfiltered queries only return the bound company',async()=>{
  const t=scoped(a,adminA);
  const [companies,projects,units,audit]=await t.transaction([t`SELECT id FROM companies`,t`SELECT company_id FROM projects`,t`SELECT company_id FROM inventory_units`,t`SELECT company_id FROM audit_logs`]);
  assert.deepEqual(ids(companies),[a]);assert.ok(ids(projects).every(id=>id===a));assert.equal(units.length,2);assert.ok(ids(units).every(id=>id===a));assert.ok(audit.length>0&&ids(audit).every(id=>id===a));});
 await check('single tagged queries are scoped too',async()=>{const t=scoped(b,adminB);assert.deepEqual(ids(await t`SELECT company_id FROM inventory_units`),[b]);});
 await check('forged context (company the user does not belong to) sees nothing',async()=>{
  const t=scoped(b,adminA);
  for(const table of ['companies','projects','inventory_units','memberships','audit_logs','company_settings','invitations'])assert.equal((await t.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n,0,table);});
 await check('rows cannot be inserted into another company',()=>reject(()=>scoped(a,adminA)`INSERT INTO projects(company_id,name) VALUES(${b},'smuggled')`,'42501'));
 await check('audit entries cannot be written for another company',()=>reject(()=>scoped(a,adminA)`INSERT INTO audit_logs(company_id,actor_id,actor_email,action) VALUES(${b},'x','x@example.com','smuggled')`,'42501'));
 await check('rows of another company cannot be updated or deleted',async()=>{
  const t=scoped(a,adminA);
  assert.equal((await t`UPDATE inventory_units SET category='hijacked' WHERE company_id=${b} RETURNING id`).length,0);
  assert.equal((await t`UPDATE projects SET name='hijacked' WHERE id=${pb} RETURNING id`).length,0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM inventory_units WHERE company_id=${b} AND category='hijacked'`)[0].n,0);});
 await check('moving a row to another company is rejected',()=>reject(()=>scoped(a,adminA)`UPDATE projects SET company_id=${b} WHERE id=${pa}`,'42501'));
 await check('inactive members and suspended companies see nothing',async()=>{
  assert.equal((await scoped(a,formerA)`SELECT count(*)::int AS n FROM inventory_units`)[0].n,0);
  assert.equal((await scoped(s,memberS)`SELECT count(*)::int AS n FROM inventory_units`)[0].n,0);});
 await check('tenant role cannot read the platform owner or migrations tables',async()=>{
  await reject(()=>scoped(a,adminA)`SELECT * FROM platform_owner`,'42501');
  await reject(()=>scoped(a,adminA)`SELECT * FROM schema_migrations`,'42501');});
 await check('tenant role cannot change company status',()=>reject(()=>scoped(a,adminA)`UPDATE companies SET status='suspended' WHERE id=${a}`,'42501'));
 await check('platform owner context is limited to the selected company',async()=>{
  const t=scoped(s,platform);assert.deepEqual(ids(await t`SELECT company_id FROM inventory_units`),[s]);assert.deepEqual(ids(await t`SELECT id FROM companies`),[s]);});
 await check('audit log is append-only even for the server role',async()=>{
  await reject(()=>sql`UPDATE audit_logs SET action='tampered' WHERE company_id=${a}`,'42501');
  await reject(()=>sql`DELETE FROM audit_logs WHERE company_id=${a}`,'42501');});
 await check('service calls bind the request to the authorized company',async()=>{
  const t=tenantSql(sql);await svc.listMembers(t,adminA,a);
  assert.deepEqual(ids(await t`SELECT company_id FROM inventory_units`).filter((v,i,x)=>x.indexOf(v)===i),[a]);});
 await check('failed authorization leaves the request unbound',async()=>{
  const t=tenantSql(sql);await reject(()=>inv.inventory(t,adminA,b,pb,{}),'FORBIDDEN');
  await reject(()=>svc.access(t,salesA,a,'members.manage'),'FORBIDDEN');});
 await check('service layer rejects foreign ids (project of another company)',async()=>{
  await reject(()=>inv.inventory(tenantSql(sql),adminA,a,pb,{}),'INVALID_PROJECT');
  await reject(()=>inv.saveUnit(tenantSql(sql),adminA,{company_id:a,project_id:pb,version:0,code:'X-1',building:'B',floor:'1',category:'Office',area:'10',proposed_price:'1',status:'available',active:true}),'INVALID_PROJECT');});
 await check('forged platform mode is rejected for company users',()=>reject(()=>proj.projectList(tenantSql(sql),adminA,b,true),'FORBIDDEN'));
 await check('every table with company_id has forced RLS and a tenant policy',async()=>{
  const rows=await sql`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,(SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname AND 'bunyra_tenant'=ANY(p.roles)) AS policies FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (EXISTS(SELECT 1 FROM information_schema.columns k WHERE k.table_schema='public' AND k.table_name=c.relname AND k.column_name='company_id') OR c.relname='companies')`;
  assert.ok(rows.length>=17);for(const r of rows)assert.ok(r.relrowsecurity&&r.relforcerowsecurity&&(r.relname==='storage_cleanup_jobs'?r.policies===0:r.policies>0),r.relname);});
 await check('tenant role does not bypass RLS',async()=>{const r=await sql`SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname='bunyra_tenant'`;assert.equal(r[0].rolbypassrls,false);assert.equal(r[0].rolsuper,false);});
 return {passed:checks.length,checks,fixtures:{company_a:a,company_b:b,company_suspended:s}};
}
