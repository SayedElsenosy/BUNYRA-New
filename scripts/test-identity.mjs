import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import assert from 'node:assert/strict';
import * as svc from '../.sites-runtime/tests/service.mjs';
import { hasPermission } from '../.sites-runtime/tests/permissions.mjs';

// Run only against a dedicated test branch. Creates isolated fixtures, never
// deletes or changes existing business records. Connection stays in memory.
export async function runIdentityTests(sql){
 const checks=[];
 async function check(name,fn){await fn();checks.push({name,passed:true});}
 async function rejects(fn,code){await assert.rejects(fn,e=>e.code===code);}
 const a=crypto.randomUUID(),b=crypto.randomUUID(),p1=crypto.randomUUID(),p2=crypto.randomUUID(),pb=crypto.randomUUID();
 const suffix=a.slice(0,8);const actor=(tag)=>({userId:`identity-test-${suffix}-${tag}`,email:`${tag}-${suffix}@example.com`});
 const admin=actor('admin'),sales=actor('sales'),adminB=actor('admin-b'),outsider=actor('outsider'),platform={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
 const owners=await sql`SELECT user_id FROM platform_owner`;
 if(owners.length&&owners[0].user_id!==platform.userId)throw Error('Refusing to run test fixtures in a database with a real platform owner. Use a test branch.');
 await sql.transaction([
 sql`INSERT INTO platform_owner(singleton,user_id,email) VALUES(true,${platform.userId},${platform.email}) ON CONFLICT DO NOTHING`,
 sql`INSERT INTO companies(id,name,account_limit) VALUES(${a},${'Identity Test A '+suffix},100),(${b},${'Identity Test B '+suffix},100)`,
 sql`INSERT INTO projects(id,company_id,name) VALUES(${p1},${a},'Cairo Plaza test'),(${p2},${a},'Kawn test'),(${pb},${b},'Other company test')`,
 sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${a},${admin.userId},${admin.email},'company_admin'),(${a},${sales.userId},${sales.email},'sales'),(${b},${adminB.userId},${adminB.email},'company_admin')`]);
 await check('company admin can list its own members',async()=>assert.equal((await svc.listMembers(tenantSql(sql),admin,a)).members.length,2));
 await check('sales cannot manage memberships',()=>rejects(()=>svc.listMembers(tenantSql(sql),sales,a),'FORBIDDEN'));
 await check('admin cannot read another company',()=>rejects(()=>svc.listMembers(tenantSql(sql),admin,b),'FORBIDDEN'));
 await check('requesting platform mode does not grant owner access',()=>rejects(()=>svc.listMembers(tenantSql(sql),admin,b,true),'FORBIDDEN'));
 await check('platform owner uses an explicit audited company context',async()=>{assert.equal((await svc.listMembers(tenantSql(sql),platform,b,true)).members.length,1);const logs=await sql`SELECT actor_id FROM audit_logs WHERE company_id=${b} AND action='platform_owner.company_access'`;assert.ok(logs.some(l=>l.actor_id===platform.userId));});
 const invited=actor('invited');const invitation=await svc.issueInvite(tenantSql(sql),admin,{company_id:a,email:invited.email,role:'sales'});
 await check('invitation stores a hash rather than its bearer token',async()=>{const rows=await sql`SELECT token_hash FROM invitations WHERE id=${invitation.id}`;assert.equal(rows[0].token_hash,await svc.tokenHash(invitation.token));assert.notEqual(rows[0].token_hash,invitation.token);});
 await check('invitation rejects an email mismatch',()=>rejects(()=>svc.acceptInvite(tenantSql(sql),outsider,invitation.token),'INVALID_INVITE'));
 await check('matching identity joins only the invited company',async()=>{assert.equal((await svc.acceptInvite(tenantSql(sql),invited,invitation.token)).company_id,a);assert.equal((await sql`SELECT company_id FROM memberships WHERE user_id=${invited.userId}`).length,1);});
 await check('accepted invitation cannot be replayed',()=>rejects(()=>svc.acceptInvite(tenantSql(sql),invited,invitation.token),'INVALID_INVITE'));
 await check('duplicate active membership cannot be reinvited',()=>rejects(()=>svc.issueInvite(tenantSql(sql),admin,{company_id:a,email:invited.email,role:'sales'}),'MEMBER_EXISTS'));
 const concurrentActor=actor('concurrent');const concurrentInvite=await svc.issueInvite(tenantSql(sql),admin,{company_id:a,email:concurrentActor.email,role:'sales'});
 await check('concurrent acceptance produces one membership and one success',async()=>{const outcomes=await Promise.allSettled([svc.acceptInvite(tenantSql(sql),concurrentActor,concurrentInvite.token),svc.acceptInvite(tenantSql(sql),concurrentActor,concurrentInvite.token)]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal((await sql`SELECT * FROM memberships WHERE company_id=${a} AND user_id=${concurrentActor.userId}`).length,1);});
 const expiredActor=actor('expired');const expired=await svc.issueInvite(tenantSql(sql),admin,{company_id:a,email:expiredActor.email,role:'sales'});await sql`UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=${expired.id}`;
 await check('expired invitation cannot be accepted',()=>rejects(()=>svc.acceptInvite(tenantSql(sql),expiredActor,expired.token),'INVALID_INVITE'));
 const revokedActor=actor('revoked');const revoked=await svc.issueInvite(tenantSql(sql),admin,{company_id:a,email:revokedActor.email,role:'sales'});await svc.revokeInvite(tenantSql(sql),admin,a,revoked.id);
 await check('revoked invitation cannot be accepted',()=>rejects(()=>svc.acceptInvite(tenantSql(sql),revokedActor,revoked.token),'INVALID_INVITE'));
 const replacementActor=actor('replacement');const older=await svc.issueInvite(tenantSql(sql),admin,{company_id:a,email:replacementActor.email,role:'sales'});const newer=await svc.issueInvite(tenantSql(sql),admin,{company_id:a,email:replacementActor.email,role:'sales'});
 await check('reissuing revokes the previous invitation token',async()=>{await rejects(()=>svc.acceptInvite(tenantSql(sql),replacementActor,older.token),'INVALID_INVITE');await svc.acceptInvite(tenantSql(sql),replacementActor,newer.token);});
 await check('last active company admin cannot be disabled',()=>rejects(()=>svc.changeMember(tenantSql(sql),platform,{company_id:a,user_id:admin.userId,role:'company_admin',active:false,version:1},true),'MEMBER_CONFLICT_OR_LAST_ADMIN'));
 await check('last active company admin cannot be demoted',()=>rejects(()=>svc.changeMember(tenantSql(sql),platform,{company_id:a,user_id:admin.userId,role:'sales',active:true,version:1},true),'MEMBER_CONFLICT_OR_LAST_ADMIN'));
 await check('member cannot change its own administrative role',()=>rejects(()=>svc.changeMember(tenantSql(sql),admin,{company_id:a,user_id:admin.userId,role:'sales',active:true,version:1}),'SELF_CHANGE_FORBIDDEN'));
 await svc.changeMember(tenantSql(sql),admin,{company_id:a,user_id:sales.userId,role:'sales',active:false,version:1});
 await check('disabled membership immediately loses access',()=>rejects(()=>svc.access(tenantSql(sql),sales,a,'company.read'),'FORBIDDEN'));
 await check('stale membership update is rejected',()=>rejects(()=>svc.changeMember(tenantSql(sql),admin,{company_id:a,user_id:sales.userId,role:'sales',active:true,version:1}),'MEMBER_CONFLICT_OR_LAST_ADMIN'));
 await svc.changeMember(tenantSql(sql),admin,{company_id:a,user_id:sales.userId,role:'sales',active:true,version:2});
 await check('reactivated membership regains permitted access',()=>svc.access(tenantSql(sql),sales,a,'company.read'));
 const role=await svc.saveRole(tenantSql(sql),admin,{company_id:a,name:'Read only '+suffix,permissions:{'company.read':true,'projects.read':true}});const customActor=actor('custom');const customInvite=await svc.issueInvite(tenantSql(sql),admin,{company_id:a,email:customActor.email,role:'sales',custom_role_id:role.id});await svc.acceptInvite(tenantSql(sql),customActor,customInvite.token);
 await check('custom role permits explicit read action',()=>svc.access(tenantSql(sql),customActor,a,'projects.read'));
 await check('custom role does not inherit legacy sales permissions',()=>rejects(()=>svc.access(tenantSql(sql),customActor,a,'leads.write'),'FORBIDDEN'));
 await check('custom role denies unspecified administration actions',()=>rejects(()=>svc.listMembers(tenantSql(sql),customActor,a),'FORBIDDEN'));
 await check('custom role from another company cannot be assigned',()=>rejects(()=>svc.issueInvite(tenantSql(sql),adminB,{company_id:b,email:actor('invalid-role').email,role:'sales',custom_role_id:role.id}),'INVALID_ROLE'));
 await svc.setPermission(tenantSql(sql),admin,{company_id:a,user_id:sales.userId,project_id:p1,action:'inventory.write',allowed:true});
 await svc.setPermission(tenantSql(sql),admin,{company_id:a,user_id:sales.userId,project_id:p2,action:'inventory.write',allowed:false});
 await check('project-specific write grant permits only its project',async()=>{await svc.access(tenantSql(sql),sales,a,'inventory.write',false,p1);await rejects(()=>svc.access(tenantSql(sql),sales,a,'inventory.write',false,p2),'FORBIDDEN');await rejects(()=>svc.access(tenantSql(sql),sales,a,'inventory.write'),'FORBIDDEN');});
 await check('foreign project cannot be used for a permission override',()=>rejects(()=>svc.setPermission(tenantSql(sql),admin,{company_id:a,user_id:sales.userId,project_id:pb,action:'inventory.write',allowed:true}),'INVALID_PROJECT'));
 await svc.setPermission(tenantSql(sql),admin,{company_id:a,user_id:sales.userId,project_id:null,action:'leads.write',allowed:false});
 await check('explicit company deny overrides the built-in role grant',()=>rejects(()=>svc.access(tenantSql(sql),sales,a,'leads.write'),'FORBIDDEN'));
 const roleVersion=1;await svc.saveRole(tenantSql(sql),admin,{company_id:a,id:role.id,version:roleVersion,name:'Updated read only '+suffix,permissions:{'company.read':true}});
 await check('stale custom-role edit is rejected',()=>rejects(()=>svc.saveRole(tenantSql(sql),admin,{company_id:a,id:role.id,version:roleVersion,name:'Stale role '+suffix,permissions:{}}),'VERSION_CONFLICT'));
 await check('RLS requires both tenant context and an active identity',async()=>{const res=await sql.transaction([sql`SET LOCAL ROLE bunyra_tenant`,sql`SELECT count(*)::int AS n FROM companies`,sql`SELECT set_config('app.company_id',${a},true),set_config('app.user_id',${admin.userId},true)`,sql`SELECT id FROM companies`,sql`SELECT id FROM projects`,sql`SELECT set_config('app.user_id',${adminB.userId},true)`,sql`SELECT count(*)::int AS n FROM companies`,sql`SELECT count(*)::int AS n FROM projects`]);assert.equal(res[1][0].n,0);assert.deepEqual(res[3].map(r=>r.id),[a]);assert.equal(res[4].length,2);assert.equal(res[6][0].n,0);assert.equal(res[7][0].n,0);});
 await check('tenant database role cannot change memberships outside its verified context',async()=>{const before=(await sql`SELECT count(*)::int AS n FROM memberships WHERE company_id=${a} AND active`)[0].n;const res=await sql.transaction([sql`SET LOCAL ROLE bunyra_tenant`,sql`UPDATE memberships SET active=false WHERE company_id=${a} RETURNING user_id`,sql`SELECT set_config('app.company_id',${a},true),set_config('app.user_id',${adminB.userId},true)`,sql`UPDATE memberships SET active=false WHERE company_id=${a} RETURNING user_id`]);assert.equal(res[1].length,0);assert.equal(res[3].length,0);assert.equal((await sql`SELECT count(*)::int AS n FROM memberships WHERE company_id=${a} AND active`)[0].n,before);});
 const suspendedActor=actor('suspended-invite');const suspended=await svc.issueInvite(tenantSql(sql),adminB,{company_id:b,email:suspendedActor.email,role:'sales'});await sql`UPDATE companies SET status='suspended' WHERE id=${b}`;
 await check('suspended company denies access to existing members',()=>rejects(()=>svc.access(tenantSql(sql),adminB,b,'company.read'),'FORBIDDEN'));
 await check('suspended company blocks invitation acceptance',()=>rejects(()=>svc.acceptInvite(tenantSql(sql),suspendedActor,suspended.token),'INVALID_INVITE'));
 await check('RLS also rejects suspended-company context',async()=>{const res=await sql.transaction([sql`SET LOCAL ROLE bunyra_tenant`,sql`SELECT set_config('app.company_id',${b},true),set_config('app.user_id',${adminB.userId},true)`,sql`SELECT count(*)::int AS n FROM companies`]);assert.equal(res[2][0].n,0);});
 const admin2=actor('admin-two');await sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${a},${admin2.userId},${admin2.email},'company_admin')`;
 await check('concurrent admin changes preserve at least one active admin',async()=>{const outcomes=await Promise.allSettled([svc.changeMember(tenantSql(sql),platform,{company_id:a,user_id:admin.userId,role:'company_admin',active:false,version:1},true),svc.changeMember(tenantSql(sql),platform,{company_id:a,user_id:admin2.userId,role:'company_admin',active:false,version:1},true)]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);const counts=await sql`SELECT count(*)::int AS n FROM memberships WHERE company_id=${a} AND role='company_admin' AND custom_role_id IS NULL AND active`;assert.equal(counts[0].n,1);});
 await check('audit log records before and after membership values without tokens',async()=>{const audit=await sql`SELECT action,before_data,after_data FROM audit_logs WHERE company_id=${a}`;assert.ok(audit.some(r=>r.action==='membership.updated'&&r.before_data?.active===true&&r.after_data?.active===false));assert.ok(!JSON.stringify(audit).includes(invitation.token));});
 await check('permission precedence is deterministic',()=>{assert.equal(hasPermission('sales',null,[{project_id:null,action:'inventory.write',allowed:false},{project_id:p1,action:'inventory.write',allowed:true}],'inventory.write',p1),true);});
 const extra=await runAuditRegressionTests(sql,svc,{company_a:a,company_b:b});checks.push(...extra.checks);
 return {passed:checks.length,total:checks.length,checks,fixtures:{company_a:a,company_b:b},scope:'Dedicated development branch only'};
}

export async function runAuditRegressionTests(sql,service,fixtures){
 const a=fixtures.company_a;const platform={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
 const email='audit-'+crypto.randomUUID()+'@example.com';
 const first=await service.issueInvite(tenantSql(sql),platform,{company_id:a,email,role:'sales'},true);
 await service.issueInvite(tenantSql(sql),platform,{company_id:a,email,role:'sales'},true);
 const replacementLogs=await sql`SELECT before_data,after_data FROM audit_logs WHERE company_id=${a} AND action='invitation.replaced' AND before_data->>'id'=${first.id}`;
 assert.equal(replacementLogs.length,1);assert.equal(replacementLogs[0].before_data.status,'pending');assert.equal(replacementLogs[0].after_data.status,'revoked');assert.ok(!JSON.stringify(replacementLogs).includes(first.token));
 const targets=await sql`SELECT user_id FROM memberships WHERE company_id=${a} AND email LIKE 'sales-%@example.com' LIMIT 1`;assert.equal(targets.length,1);
 const input={company_id:a,user_id:targets[0].user_id,project_id:null,action:'finance.read'};
 await service.setPermission(tenantSql(sql),platform,{...input,allowed:false},true);
 await Promise.all([service.setPermission(tenantSql(sql),platform,{...input,allowed:true},true),service.setPermission(tenantSql(sql),platform,{...input,allowed:false},true)]);
 const records=await sql`SELECT before_data,after_data FROM audit_logs WHERE company_id=${a} AND action='permission.updated' AND after_data->>'action'='finance.read' AND after_data->>'user_id'=${input.user_id} ORDER BY id DESC LIMIT 3`;
 assert.equal(records.length,3);const ordered=records.reverse();assert.equal(ordered[1].before_data.allowed,ordered[0].after_data.allowed);assert.equal(ordered[2].before_data.allowed,ordered[1].after_data.allowed);
 return {checks:[{name:'replaced invitations audit the revocation without bearer tokens',passed:true},{name:'concurrent permission updates preserve an accurate audit chain',passed:true}]};
}
