import { z } from 'zod';
import { access,owner,ServiceError,newToken,tokenHash,uuid,type Sql,type Actor } from './service';
import { bindTenant } from './tenant';
import { passwordSchema,usernameSchema,hashPassword,verifyPassword,DUMMY_HASH } from './passwords';
import { ROLES,hasPermission } from './permissions';
export const accountFields=z.object({username:usernameSchema,display_name:z.string().trim().min(2).max(120),email:z.union([z.string().trim().toLowerCase().email().max(254),z.literal('')]).default(''),password:passwordSchema});
const createSchema=accountFields.extend({company_id:uuid,role:z.enum(ROLES),custom_role_id:uuid.nullable().default(null)});
async function manage(sql:Sql,actor:Actor,companyId:string,asOwner:boolean){await access(sql,actor,companyId,'members.manage',asOwner);bindTenant(sql,null);if(!(await sql`SELECT id FROM companies WHERE id=${companyId} AND status='active'`).length)throw new ServiceError('COMPANY_INACTIVE',409);}
export async function accountSummary(sql:Sql,actor:Actor,companyId:string,asOwner=false){await access(sql,actor,companyId,'company.read',asOwner);const r=await sql`SELECT account_limit,(SELECT count(*)::int FROM memberships WHERE company_id=${companyId} AND active) AS used,(SELECT count(*)::int FROM invitations i WHERE i.company_id=${companyId} AND i.status='pending' AND i.expires_at>now() AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=i.company_id AND m.active AND lower(m.email)=i.email)) AS reserved FROM companies WHERE id=${companyId}`;return r[0];}
export async function createAccount(sql:Sql,actor:Actor,input:unknown,asOwner=false){
 const c=createSchema.parse(input);await manage(sql,actor,c.company_id,asOwner);try {
 if(c.custom_role_id&&!(await sql`SELECT id FROM custom_roles WHERE company_id=${c.company_id} AND id=${c.custom_role_id}`).length)throw new ServiceError('INVALID_ROLE');
 const userId=crypto.randomUUID(),hash=await hashPassword(c.password),email=c.email||c.username;
 const r=await sql.transaction([
  sql`SELECT id FROM companies WHERE id=${c.company_id} AND status='active' FOR UPDATE`,
  sql`INSERT INTO memberships(company_id,user_id,email,role,custom_role_id) VALUES(${c.company_id},${userId},${email},${c.role},${c.custom_role_id})`,
  sql`INSERT INTO app_accounts(user_id,company_id,username,display_name,email,password_hash,created_by) VALUES(${userId},${c.company_id},${c.username},${c.display_name},${c.email},${hash},${actor.userId}) RETURNING user_id,username`,
  sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'account.created',${JSON.stringify({user_id:userId,username:c.username,role:c.role,custom_role_id:c.custom_role_id})}::jsonb)`
 ]);return r[2][0];
} finally { bindTenant(sql,c.company_id,actor.userId); }
}

export async function resetAccount(sql:Sql,actor:Actor,input:unknown,asOwner=false){
 const c=accountFields.omit({password:true}).extend({company_id:uuid,user_id:z.string().min(1).max(200),password:z.union([passwordSchema,z.literal('')]).optional()}).parse(input);
 const ctx=await access(sql,actor,c.company_id,'accounts.manage',asOwner);bindTenant(sql,null);try {
 if(await owner(sql,{userId:c.user_id,email:''}))throw new ServiceError('SELF_CHANGE_FORBIDDEN',409);
 const target=(await sql`SELECT m.role,a.password_hash FROM memberships m LEFT JOIN app_accounts a ON a.user_id=m.user_id AND a.company_id=m.company_id WHERE m.company_id=${c.company_id} AND m.user_id=${c.user_id}`)[0];if(!target)throw new ServiceError('NOT_FOUND',404);
 // Operations can edit basic details, but resetting an administrator's password
 // would grant its full authority and remains an administrator-only operation.
 if(c.password&&target.role==='company_admin'&&!ctx.owner&&!hasPermission(ctx.role,ctx.custom,ctx.overrides,'members.manage'))throw new ServiceError('ADMIN_PASSWORD_FORBIDDEN',403);
 const hash=c.password?await hashPassword(c.password):target.password_hash;if(!hash)throw new ServiceError('ACCOUNT_PASSWORD_REQUIRED');
 const r=await sql.transaction([
  sql`SELECT id FROM companies WHERE id=${c.company_id} FOR UPDATE`,
  sql`WITH target AS(SELECT m.user_id FROM memberships m WHERE m.company_id=${c.company_id} AND m.user_id=${c.user_id} AND NOT EXISTS(SELECT 1 FROM app_accounts a WHERE a.user_id=m.user_id AND a.company_id IS DISTINCT FROM m.company_id) FOR UPDATE), changed AS(INSERT INTO app_accounts(user_id,company_id,username,display_name,email,password_hash,created_by) SELECT user_id,${c.company_id},${c.username},${c.display_name},${c.email},${hash},${actor.userId} FROM target ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,email=excluded.email,password_hash=excluded.password_hash,must_change_password=false,password_version=app_accounts.password_version+1,updated_at=now() RETURNING user_id) SELECT user_id FROM changed`,
  sql`UPDATE memberships SET email=${c.email||c.username},version=version+1 WHERE company_id=${c.company_id} AND user_id=${c.user_id} AND EXISTS(SELECT 1 FROM app_accounts WHERE user_id=${c.user_id} AND company_id=${c.company_id})`,
  sql`DELETE FROM app_sessions WHERE user_id=${c.user_id} AND EXISTS(SELECT 1 FROM app_accounts WHERE user_id=${c.user_id} AND company_id=${c.company_id})`,
  sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},${c.password?'account.credentials_reset':'account.profile_updated'},${JSON.stringify({user_id:c.user_id,username:c.username,display_name:c.display_name,email:c.email})}::jsonb WHERE EXISTS(SELECT 1 FROM app_accounts WHERE user_id=${c.user_id} AND company_id=${c.company_id})`
 ]);if(!r[1].length)throw new ServiceError('NOT_FOUND',404);return {ok:true};
} finally { bindTenant(sql,c.company_id,actor.userId); }
}

export async function setAccountLimit(sql:Sql,actor:Actor,input:unknown){
 bindTenant(sql,null);if(!await owner(sql,actor))throw new ServiceError('FORBIDDEN',403);
 const c=z.object({company_id:uuid,account_limit:z.number().int().min(0).max(10000),version:z.number().int().positive()}).parse(input);
 const r=await sql`WITH previous AS(SELECT * FROM companies WHERE id=${c.company_id} AND version=${c.version} AND status<>'deleted' FOR UPDATE), changed AS(UPDATE companies SET account_limit=${c.account_limit},version=version+1,updated_at=now() WHERE id IN(SELECT id FROM previous) RETURNING id,account_limit,version), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT changed.id,${actor.userId},${actor.email},'company.account_limit_updated',jsonb_build_object('account_limit',previous.account_limit),to_jsonb(changed) FROM changed JOIN previous USING(id)) SELECT * FROM changed`;
 if(!r.length)throw new ServiceError('VERSION_CONFLICT',409);return r[0];
}
export async function throttleLogin(sql:Sql,username:string,ip:string){
 const userBucket=await tokenHash('user:'+username),ipBucket=await tokenHash('ip:'+ip);
 const rows=await sql`INSERT INTO app_login_limits(bucket,attempts,expires_at) VALUES(${userBucket},1,now()+interval '15 minutes'),(${ipBucket},1,now()+interval '15 minutes') ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN app_login_limits.expires_at<now() THEN 1 ELSE app_login_limits.attempts+1 END,expires_at=CASE WHEN app_login_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE app_login_limits.expires_at END RETURNING bucket,attempts`;
 if(rows.some(r=>r.attempts>(r.bucket===userBucket?10:60)))throw new ServiceError('RATE_LIMITED',429);
}
export async function authenticateAccount(sql:Sql,username:string,password:string,portal:'owner'|'company'){
 const rows=await sql`SELECT a.*,EXISTS(SELECT 1 FROM platform_owner o WHERE o.user_id=a.user_id) AS is_owner FROM app_accounts a WHERE username=${username}`;
 const a=rows[0];const valid=await verifyPassword(password,a?.password_hash||DUMMY_HASH);
 if(!a||!valid||((portal==='owner')!==a.is_owner))throw new ServiceError('INVALID_CREDENTIALS',401);
 if(!a.is_owner&&!(await sql`SELECT m.user_id FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=${a.user_id} AND m.company_id=${a.company_id} AND m.active AND c.status='active'`).length)throw new ServiceError('INVALID_CREDENTIALS',401);
 return {userId:a.user_id as string,email:(a.email||a.username) as string,displayName:a.display_name as string,mustChangePassword:false,passwordVersion:a.password_version as number};
}
export async function createSession(sql:Sql,userId:string,passwordVersion:number){
 const secret=await newToken();const r=await sql`INSERT INTO app_sessions(token_hash,user_id,password_version,expires_at) SELECT ${secret.hash},user_id,password_version,now()+interval '12 hours' FROM app_accounts WHERE user_id=${userId} AND password_version=${passwordVersion} RETURNING user_id`;
 if(!r.length)throw new ServiceError('UNAUTHORIZED',401);return secret.token;
}
export async function readSession(sql:Sql,token:string){
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const r=await sql`SELECT a.user_id,a.username,a.email,a.display_name,a.must_change_password FROM app_sessions s JOIN app_accounts a ON a.user_id=s.user_id AND a.password_version=s.password_version WHERE s.token_hash=${await tokenHash(token)} AND s.expires_at>now() AND (EXISTS(SELECT 1 FROM platform_owner o WHERE o.user_id=a.user_id) OR EXISTS(SELECT 1 FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=a.user_id AND m.company_id=a.company_id AND m.active AND c.status='active'))`;
 const a=r[0];return a?{userId:a.user_id as string,email:(a.email||a.username) as string,displayName:a.display_name as string,fullName:a.display_name as string,mustChangePassword:false}:null;
}
export async function ownAccount(sql:Sql,actor:Actor){const r=await sql`SELECT username,display_name,email,must_change_password FROM app_accounts WHERE user_id=${actor.userId}`;return r[0]||null;}
export async function saveOwnAccount(sql:Sql,actor:Actor,input:unknown){
 if(!await owner(sql,actor))throw new ServiceError('FORBIDDEN',403);
 const c=accountFields.extend({current_password:z.string().max(128).default('')}).parse(input);
 const existing=(await sql`SELECT password_hash,password_version FROM app_accounts WHERE user_id=${actor.userId}`)[0];
 if(existing&&!await verifyPassword(c.current_password,existing.password_hash))throw new ServiceError('CURRENT_PASSWORD_INVALID',400);
 if(!existing&&!await owner(sql,actor))throw new ServiceError('FORBIDDEN',403);
 if(existing&&await verifyPassword(c.password,existing.password_hash))throw new ServiceError('PASSWORD_UNCHANGED',400);
 const hash=await hashPassword(c.password);
 const r=await sql`WITH changed AS(INSERT INTO app_accounts(user_id,username,display_name,email,password_hash,must_change_password,created_by) VALUES(${actor.userId},${c.username},${c.display_name},${c.email},${hash},false,${actor.userId}) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,email=excluded.email,password_hash=excluded.password_hash,must_change_password=false,password_version=app_accounts.password_version+1,updated_at=now() WHERE app_accounts.password_version=${existing?.password_version||0} RETURNING user_id,password_version), revoked AS(DELETE FROM app_sessions WHERE user_id IN(SELECT user_id FROM changed)), logged AS(INSERT INTO audit_logs(actor_id,actor_email,action,after_data) SELECT ${actor.userId},${actor.email},'account.self_updated',${JSON.stringify({username:c.username})}::jsonb FROM changed) SELECT password_version FROM changed`;
 if(!r.length)throw new ServiceError('VERSION_CONFLICT',409);return {ok:true,passwordVersion:r[0].password_version as number};
}
