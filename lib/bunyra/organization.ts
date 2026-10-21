import { z } from 'zod';
import { access,ServiceError,uuid,type Sql,type Actor } from './service';
import { hasPermission } from './permissions';
export const KINDS=['branch','department','team','legal_entity','cost_center'] as const;
const text=z.string().trim();
export const settingsSchema=z.object({company_id:uuid,version:z.number().int().min(0),company_version:z.number().int().positive(),name:text.min(2).max(160),name_en:text.max(160),email:z.union([z.string().email(),z.literal('')]),phone:text.max(40),address:text.max(500),logo_url:z.union([z.literal(''),z.string().url().max(2048).refine(v=>new URL(v).protocol==='https:')]),currency:z.string().regex(/^[A-Z]{3}$/),time_zone:z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}),locale:z.enum(['ar','en']),follow_up_escalation_hours:z.coerce.number().int().min(1).max(720).optional()});
export const nodeSchema=z.object({company_id:uuid,id:uuid.optional(),version:z.number().int().positive().optional(),kind:z.enum(KINDS),code:text.min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),name:text.min(2).max(160),name_en:text.max(160).default(''),parent_id:uuid.nullable().default(null),manager_user_id:z.string().min(1).max(200).nullable().default(null),active:z.boolean().default(true)});
export const placementSchema=z.object({company_id:uuid,id:uuid.optional(),version:z.number().int().positive().optional(),user_id:z.string().min(1).max(200),node_id:uuid,project_id:uuid.nullable().default(null),active:z.boolean()});
export async function organization(sql:Sql,actor:Actor,id:string,platform=false){
 const ctx=await access(sql,actor,id,'company.read',platform);
 const canWrite=ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'company.write');
 const canAssign=ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'members.manage');
 const results=await Promise.all([
 sql`SELECT id,name,name_en,email,phone,address,version,status FROM companies WHERE id=${id}`,
 sql`SELECT * FROM company_settings WHERE company_id=${id}`,
 sql`SELECT id,kind,code,name,name_en,parent_id,manager_user_id,active,version FROM organization_nodes WHERE company_id=${id} ORDER BY kind,name`,
 canAssign?sql`SELECT user_id,email,active FROM memberships WHERE company_id=${id} ORDER BY email`:Promise.resolve([]),
 canAssign?sql`SELECT id,user_id,node_id,project_id,active,version FROM member_placements WHERE company_id=${id} ORDER BY id`:Promise.resolve([]),
 sql`SELECT id,name FROM projects WHERE company_id=${id} ORDER BY name`]);
 return {company:results[0][0],settings:results[1][0]||{logo_url:'',currency:'EGP',time_zone:'Africa/Cairo',locale:'ar',follow_up_escalation_hours:24,version:0},nodes:results[2],members:results[3],placements:results[4],projects:results[5].filter(p=>ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'projects.read',p.id)),capabilities:{write:canWrite,assign:canAssign}};
}
export async function saveSettings(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=settingsSchema.parse(input);await access(sql,actor,c.company_id,'company.write',platform);
 const result=await sql.transaction([
 sql`SELECT id FROM companies WHERE id=${c.company_id} FOR UPDATE`,
 sql`WITH previous AS(SELECT c.*,s.version AS settings_version,to_jsonb(s) AS settings_data FROM companies c LEFT JOIN company_settings s ON s.company_id=c.id WHERE c.id=${c.company_id} AND c.version=${c.company_version} AND coalesce(s.version,0)=${c.version}), changed_company AS(UPDATE companies SET name=${c.name},name_en=${c.name_en},email=${c.email},phone=${c.phone},address=${c.address},version=version+1,updated_at=now() WHERE id IN(SELECT id FROM previous) RETURNING *), changed AS(INSERT INTO company_settings(company_id,logo_url,currency,time_zone,locale,follow_up_escalation_hours) SELECT id,${c.logo_url},${c.currency},${c.time_zone},${c.locale},COALESCE(${c.follow_up_escalation_hours??null}::int,24) FROM changed_company ON CONFLICT(company_id) DO UPDATE SET logo_url=excluded.logo_url,currency=excluded.currency,time_zone=excluded.time_zone,locale=excluded.locale,follow_up_escalation_hours=COALESCE(${c.follow_up_escalation_hours??null}::int,company_settings.follow_up_escalation_hours),version=company_settings.version+1,updated_at=now() RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT changed.company_id,${actor.userId},${actor.email},'company.settings_updated',to_jsonb(previous),jsonb_build_object('settings',to_jsonb(changed),'company',to_jsonb(changed_company)) FROM changed JOIN changed_company ON changed_company.id=changed.company_id JOIN previous ON previous.id=changed.company_id) SELECT company_id FROM changed`]);
 if(!result[1].length)throw new ServiceError('VERSION_CONFLICT',409);return {ok:true};
}
export async function saveNode(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=nodeSchema.parse(input);await access(sql,actor,c.company_id,'company.write',platform);
 if(c.id&&!c.version)throw new ServiceError('VERSION_REQUIRED');
 const mutation=c.id?sql`WITH previous AS(SELECT * FROM organization_nodes WHERE company_id=${c.company_id} AND id=${c.id} AND version=${c.version!} FOR UPDATE), changed AS(UPDATE organization_nodes SET code=${c.code},name=${c.name},name_en=${c.name_en},parent_id=${c.parent_id},manager_user_id=${c.manager_user_id},active=${c.active},version=version+1 WHERE company_id=${c.company_id} AND id IN(SELECT id FROM previous WHERE kind=${c.kind}) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'organization.updated',to_jsonb(previous),to_jsonb(changed) FROM previous JOIN changed USING(id)) SELECT id FROM changed`:sql`WITH created AS(INSERT INTO organization_nodes(company_id,kind,code,name,name_en,parent_id,manager_user_id,active) VALUES(${c.company_id},${c.kind},${c.code},${c.name},${c.name_en},${c.parent_id},${c.manager_user_id},${c.active}) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'organization.created',to_jsonb(created) FROM created) SELECT id FROM created`;
 const result=await sql.transaction([sql`SELECT id FROM companies WHERE id=${c.company_id} FOR UPDATE`,mutation]);
 if(!result[1].length)throw new ServiceError('VERSION_CONFLICT',409);return result[1][0];
}
export async function savePlacement(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=placementSchema.parse(input);await access(sql,actor,c.company_id,'members.manage',platform);
 if(c.project_id)await access(sql,actor,c.company_id,'projects.read',platform,c.project_id);
 if(c.id&&!c.version)throw new ServiceError('VERSION_REQUIRED');
 const mutation=c.id?sql`WITH previous AS(SELECT * FROM member_placements WHERE company_id=${c.company_id} AND id=${c.id} AND version=${c.version!} FOR UPDATE), changed AS(UPDATE member_placements SET active=${c.active},version=version+1 WHERE company_id=${c.company_id} AND id IN(SELECT id FROM previous WHERE user_id=${c.user_id} AND node_id=${c.node_id} AND project_id IS NOT DISTINCT FROM ${c.project_id}::uuid) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'placement.updated',to_jsonb(previous),to_jsonb(changed) FROM previous JOIN changed USING(id)) SELECT id FROM changed`:sql`WITH created AS(INSERT INTO member_placements(company_id,user_id,node_id,project_id,active) VALUES(${c.company_id},${c.user_id},${c.node_id},${c.project_id},${c.active}) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'placement.created',to_jsonb(created) FROM created) SELECT id FROM created`;
 const result=await sql.transaction([sql`SELECT id FROM companies WHERE id=${c.company_id} FOR UPDATE`,mutation]);
 if(!result[1].length)throw new ServiceError('VERSION_CONFLICT',409);return result[1][0];
}
