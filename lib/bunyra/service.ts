import type { NeonQueryFunction } from '@neondatabase/serverless';
import { z } from 'zod';
import { ACTIONS, ROLES, hasPermission, type Role, type Action, type PermissionOverride } from './permissions';
export type Sql=NeonQueryFunction<false,false>;
export type Actor={userId:string;email:string};
export class ServiceError extends Error { constructor(public code:string,public status=400){super(code);} }
export const uuid=z.string().uuid();
export const inviteSchema=z.object({company_id:uuid,email:z.string().trim().email().max(254).transform(s=>s.toLowerCase()),role:z.enum(ROLES),custom_role_id:uuid.nullable().default(null)});
export const memberSchema=z.object({company_id:uuid,user_id:z.string().min(1).max(200),role:z.enum(ROLES),custom_role_id:uuid.nullable().default(null),active:z.boolean(),version:z.number().int().positive()});
export const roleSchema=z.object({company_id:uuid,id:uuid.optional(),version:z.number().int().positive().optional(),name:z.string().trim().min(2).max(100),permissions:z.record(z.enum(ACTIONS),z.boolean())});
export const permissionSchema=z.object({company_id:uuid,user_id:z.string().min(1).max(200),project_id:uuid.nullable().default(null),action:z.enum(ACTIONS),allowed:z.boolean()});
export async function owner(sql:Sql,actor:Actor){return (await sql`SELECT user_id FROM platform_owner WHERE user_id=${actor.userId}`).length>0;}
export async function access(sql:Sql,actor:Actor,companyId:string,action:Action,asOwner=false,projectId?:string){
 uuid.parse(companyId);
 if(projectId){uuid.parse(projectId);if(!(await sql`SELECT id FROM projects WHERE company_id=${companyId} AND id=${projectId}`).length)throw new ServiceError('INVALID_PROJECT');}
 if(asOwner){if(!await owner(sql,actor))throw new ServiceError('FORBIDDEN',403);if(!(await sql`SELECT id FROM companies WHERE id=${companyId}`).length)throw new ServiceError('NOT_FOUND',404);await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${companyId},${actor.userId},${actor.email},'platform_owner.company_access',${JSON.stringify({requested_action:action})}::jsonb)`;return {owner:true,role:'company_admin' as Role,custom:null,overrides:[] as PermissionOverride[]};}
 const rows=await sql`SELECT m.role,m.custom_role_id,r.permissions FROM memberships m JOIN companies c ON c.id=m.company_id LEFT JOIN custom_roles r ON r.company_id=m.company_id AND r.id=m.custom_role_id WHERE m.company_id=${companyId} AND m.user_id=${actor.userId} AND m.active AND c.status='active'`;
 if(!rows.length)throw new ServiceError('FORBIDDEN',403);
 const m=rows[0]; const overrides=await sql`SELECT action,project_id,allowed FROM member_permissions WHERE company_id=${companyId} AND user_id=${actor.userId}` as PermissionOverride[];
 const ctx={owner:false,role:m.role as Role,custom:m.custom_role_id?(m.permissions||{} as Record<string,boolean>):null,overrides};
 if(!hasPermission(ctx.role,ctx.custom,overrides,action,projectId))throw new ServiceError('FORBIDDEN',403);
 return ctx;
}
export async function tokenHash(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function newToken(){const bytes=crypto.getRandomValues(new Uint8Array(32));const token=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return {token,hash:await tokenHash(token)};}
export async function listMembers(sql:Sql,actor:Actor,companyId:string,asOwner=false){
 const ctx=await access(sql,actor,companyId,'company.read',asOwner);
 const canManageMembers=ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'members.manage');
 const canManageRoles=ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'roles.manage');
 if(!canManageMembers&&!canManageRoles)throw new ServiceError('FORBIDDEN',403);
 const [members,invites,roles,projects,permissions]=await Promise.all([
 sql`SELECT m.user_id,m.email,m.role,m.custom_role_id,m.active,m.version,r.name AS custom_role_name FROM memberships m LEFT JOIN custom_roles r ON r.company_id=m.company_id AND r.id=m.custom_role_id WHERE m.company_id=${companyId} ORDER BY m.email`,
 sql`SELECT id,email,role,custom_role_id,status,expires_at,created_at FROM invitations WHERE company_id=${companyId} ORDER BY created_at DESC LIMIT 100`,
 sql`SELECT id,name,permissions,version FROM custom_roles WHERE company_id=${companyId} ORDER BY name`,
 sql`SELECT id,name FROM projects WHERE company_id=${companyId} ORDER BY name`,
 sql`SELECT user_id,project_id,action,allowed FROM member_permissions WHERE company_id=${companyId}`]);
 return {members,invites:canManageMembers?invites:[],roles,projects,permissions,capabilities:{members:canManageMembers,roles:canManageRoles},actor_id:actor.userId};
}
export async function issueInvite(sql:Sql,actor:Actor,input:unknown,asOwner=false){
 const c=inviteSchema.parse(input);await access(sql,actor,c.company_id,'members.manage',asOwner);
 if(c.custom_role_id&&!(await sql`SELECT id FROM custom_roles WHERE company_id=${c.company_id} AND id=${c.custom_role_id}`).length)throw new ServiceError('INVALID_ROLE');
 if((await sql`SELECT user_id FROM memberships WHERE company_id=${c.company_id} AND lower(email)=${c.email} AND active`).length)throw new ServiceError('MEMBER_EXISTS',409);
 const secret=await newToken();const id=crypto.randomUUID();
 await sql.transaction([
 sql`SELECT pg_advisory_xact_lock(hashtextextended(${c.company_id+':'+c.email},0))`,
 sql`WITH previous AS(SELECT id,status FROM invitations WHERE company_id=${c.company_id} AND email=${c.email} AND status='pending' FOR UPDATE), changed AS(UPDATE invitations SET status='revoked' WHERE id IN(SELECT id FROM previous) RETURNING id,status), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'invitation.replaced',to_jsonb(previous),to_jsonb(changed) FROM previous JOIN changed USING(id)) SELECT id FROM changed`,
 sql`INSERT INTO invitations(id,company_id,email,role,custom_role_id,token_hash,created_by) VALUES(${id},${c.company_id},${c.email},${c.role},${c.custom_role_id},${secret.hash},${actor.userId})`,
 sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'invitation.created',${JSON.stringify({id,email:c.email,role:c.role,custom_role_id:c.custom_role_id})}::jsonb)`]);
 return {id,token:secret.token};
}
export async function acceptInvite(sql:Sql,actor:Actor,token:string){
 if(!/^[a-f0-9]{64}$/.test(token))throw new ServiceError('INVALID_INVITE',404);
 const hash=await tokenHash(token);
 const rows=await sql`WITH invitation AS(SELECT i.* FROM invitations i JOIN companies c ON c.id=i.company_id WHERE i.token_hash=${hash} AND i.email=${actor.email.toLowerCase()} AND i.status='pending' AND i.expires_at>now() AND c.status='active' FOR UPDATE OF i), joined AS(INSERT INTO memberships(company_id,user_id,email,role,custom_role_id) SELECT company_id,${actor.userId},email,role,custom_role_id FROM invitation ON CONFLICT(company_id,user_id) DO UPDATE SET email=excluded.email,role=excluded.role,custom_role_id=excluded.custom_role_id,active=true,version=memberships.version+1 RETURNING *), accepted AS(UPDATE invitations SET status='accepted',accepted_by=${actor.userId} WHERE id IN(SELECT id FROM invitation) AND EXISTS(SELECT 1 FROM joined) RETURNING id), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT joined.company_id,${actor.userId},${actor.email},'invitation.accepted',jsonb_build_object('role',joined.role,'invitation_id',accepted.id) FROM joined CROSS JOIN accepted) SELECT company_id,role FROM joined`;
 if(!rows.length)throw new ServiceError('INVALID_INVITE',409);return rows[0];
}
export async function revokeInvite(sql:Sql,actor:Actor,companyId:string,id:string,asOwner=false){
 uuid.parse(id);await access(sql,actor,companyId,'members.manage',asOwner);
 const rows=await sql`WITH changed AS(UPDATE invitations SET status='revoked' WHERE company_id=${companyId} AND id=${id} AND status='pending' RETURNING id,email), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${companyId},${actor.userId},${actor.email},'invitation.revoked',to_jsonb(changed) FROM changed) SELECT id FROM changed`;
 if(!rows.length)throw new ServiceError('INVITE_NOT_PENDING',409);return {ok:true};
}
export async function changeMember(sql:Sql,actor:Actor,input:unknown,asOwner=false){
 const c=memberSchema.parse(input);await access(sql,actor,c.company_id,'members.manage',asOwner);
 if(c.user_id===actor.userId&&!asOwner)throw new ServiceError('SELF_CHANGE_FORBIDDEN',409);
 if(c.custom_role_id&&!(await sql`SELECT id FROM custom_roles WHERE company_id=${c.company_id} AND id=${c.custom_role_id}`).length)throw new ServiceError('INVALID_ROLE');
 const results=await sql.transaction([
 sql`SELECT id FROM companies WHERE id=${c.company_id} FOR UPDATE`,
 sql`WITH previous AS(SELECT * FROM memberships m WHERE m.company_id=${c.company_id} AND m.user_id=${c.user_id} AND m.version=${c.version} AND (NOT(m.role='company_admin' AND m.custom_role_id IS NULL AND m.active) OR (${c.active} AND ${c.role}='company_admin' AND ${c.custom_role_id}::uuid IS NULL) OR (SELECT count(*) FROM memberships x WHERE x.company_id=m.company_id AND x.role='company_admin' AND x.custom_role_id IS NULL AND x.active)>1) FOR UPDATE), changed AS(UPDATE memberships SET role=${c.role},custom_role_id=${c.custom_role_id},active=${c.active},version=version+1 WHERE company_id=${c.company_id} AND user_id IN(SELECT user_id FROM previous) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'membership.updated',to_jsonb(previous),to_jsonb(changed) FROM previous JOIN changed USING(company_id,user_id)) SELECT user_id FROM changed`]);
 if(!results[1].length)throw new ServiceError('MEMBER_CONFLICT_OR_LAST_ADMIN',409);return {ok:true};
}
export async function saveRole(sql:Sql,actor:Actor,input:unknown,asOwner=false){
 const c=roleSchema.parse(input);await access(sql,actor,c.company_id,'roles.manage',asOwner);
 if(c.id&&!c.version)throw new ServiceError('VERSION_REQUIRED');
 const rows=c.id?await sql`WITH previous AS(SELECT * FROM custom_roles WHERE company_id=${c.company_id} AND id=${c.id} AND version=${c.version!} FOR UPDATE), changed AS(UPDATE custom_roles SET name=${c.name},permissions=${JSON.stringify(c.permissions)}::jsonb,version=version+1 WHERE company_id=${c.company_id} AND id IN(SELECT id FROM previous) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'role.updated',to_jsonb(previous),to_jsonb(changed) FROM previous JOIN changed USING(id)) SELECT id FROM changed`:await sql`WITH created AS(INSERT INTO custom_roles(company_id,name,permissions) VALUES(${c.company_id},${c.name},${JSON.stringify(c.permissions)}::jsonb) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'role.created',to_jsonb(created) FROM created) SELECT id FROM created`;
 if(!rows.length)throw new ServiceError('VERSION_CONFLICT',409);return rows[0];
}
export async function setPermission(sql:Sql,actor:Actor,input:unknown,asOwner=false){
 const c=permissionSchema.parse(input);await access(sql,actor,c.company_id,'roles.manage',asOwner);
 if(c.user_id===actor.userId&&!asOwner)throw new ServiceError('SELF_CHANGE_FORBIDDEN',409);
 if(!(await sql`SELECT user_id FROM memberships WHERE company_id=${c.company_id} AND user_id=${c.user_id}`).length)throw new ServiceError('NOT_FOUND',404);
 if(c.project_id&&!(await sql`SELECT id FROM projects WHERE company_id=${c.company_id} AND id=${c.project_id}`).length)throw new ServiceError('INVALID_PROJECT');
 await sql.transaction([sql`SELECT pg_advisory_xact_lock(hashtextextended(${c.company_id+':'+c.user_id+':'+(c.project_id||'company')+':'+c.action},0))`,
 sql`WITH previous AS(SELECT * FROM member_permissions WHERE company_id=${c.company_id} AND user_id=${c.user_id} AND project_id IS NOT DISTINCT FROM ${c.project_id}::uuid AND action=${c.action}), changed AS(INSERT INTO member_permissions(company_id,user_id,project_id,action,allowed) VALUES(${c.company_id},${c.user_id},${c.project_id},${c.action},${c.allowed}) ON CONFLICT(company_id,user_id,project_id,action) DO UPDATE SET allowed=excluded.allowed RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'permission.updated',(SELECT to_jsonb(previous) FROM previous),to_jsonb(changed) FROM changed) SELECT id FROM changed`]);
 return {ok:true};
}
