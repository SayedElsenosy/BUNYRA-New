import { neon } from '@neondatabase/serverless';
import { platformIdentity, failure } from '../../../lib/bunyra/http';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
const companySchema = z.object({name:z.string().trim().min(2).max(160),name_en:z.string().trim().max(160).default(''),email:z.union([z.string().email(),z.literal('')]).default(''),phone:z.string().trim().max(40).default(''),address:z.string().trim().max(500).default('')});
const updateSchema=companySchema.extend({id:z.string().uuid(),version:z.number().int().positive(),status:z.enum(['active','suspended'])});
function database(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_NOT_CONFIGURED');return neon(process.env.DATABASE_URL);}
function reply(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
async function authorize(){
 try{const {sql,user}=await platformIdentity();return {sql,user};}catch(e){return {error:failure(e)};}
}
export async function GET(request:Request){
 try{const auth=await authorize();if(auth.error)return auth.error;const {sql,user}=auth;
 const selected=new URL(request.url).searchParams.get('company');
 if(selected){if(!z.string().uuid().safeParse(selected).success)return reply({error:'INVALID_ID'},400);
 const found=await sql`SELECT * FROM companies WHERE id=${selected}`;if(!found.length)return reply({error:'NOT_FOUND'},404);
 const result=await sql.transaction([
 sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action) VALUES(${selected},${user.userId},${user.email},'company.view')`,
 sql`SELECT id,name,created_at FROM projects WHERE company_id=${selected} ORDER BY name`,
 sql`SELECT email,role,active FROM memberships WHERE company_id=${selected} ORDER BY email`
 ]);return reply({company:found[0],projects:result[1],members:result[2]});}
 const [companies,logs]=await Promise.all([sql`SELECT c.*, (SELECT count(*)::int FROM memberships m WHERE m.company_id=c.id AND m.active) AS users_count,(SELECT count(*)::int FROM projects p WHERE p.company_id=c.id) AS projects_count FROM companies c ORDER BY created_at DESC`,sql`SELECT a.id::text,a.company_id,a.actor_email,a.action,a.created_at,c.name AS company_name FROM audit_logs a LEFT JOIN companies c ON c.id=a.company_id ORDER BY a.id DESC LIMIT 100`]);
 return reply({companies,logs,user:{name:user.displayName,email:user.email}});
 }catch(error){console.error('platform read failed',error instanceof Error?error.message:'unknown');return reply({error:'SERVICE_UNAVAILABLE'},503);}
}
export async function POST(request:Request){
 try{if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'INVALID_ORIGIN'},403);
 const auth=await authorize();if(auth.error)return auth.error;const {sql,user}=auth;
 const parsed=companySchema.safeParse(await request.json());if(!parsed.success)return reply({error:'VALIDATION_ERROR'},400);const c=parsed.data;
 const rows=await sql`WITH created AS (INSERT INTO companies(name,name_en,email,phone,address) VALUES(${c.name},${c.name_en},${c.email},${c.phone},${c.address}) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT id,${user.userId},${user.email},'company.created',to_jsonb(created) FROM created) SELECT * FROM created`;
 return reply({company:rows[0]},201);
 }catch{return reply({error:'SAVE_FAILED'},500);}
}
export async function PATCH(request:Request){
 try{if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'INVALID_ORIGIN'},403);
 const auth=await authorize();if(auth.error)return auth.error;const {sql,user}=auth;
 const parsed=updateSchema.safeParse(await request.json());if(!parsed.success)return reply({error:'VALIDATION_ERROR'},400);const c=parsed.data;
 const rows=await sql`WITH previous AS(SELECT * FROM companies WHERE id=${c.id} AND version=${c.version} FOR UPDATE), changed AS(UPDATE companies SET name=${c.name},name_en=${c.name_en},email=${c.email},phone=${c.phone},address=${c.address},status=${c.status},updated_at=now(),version=version+1 WHERE id IN(SELECT id FROM previous) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT changed.id,${user.userId},${user.email},'company.updated',to_jsonb(previous),to_jsonb(changed) FROM changed JOIN previous ON changed.id=previous.id) SELECT * FROM changed`;
 return rows.length?reply({company:rows[0]}):reply({error:'VERSION_CONFLICT'},409);
 }catch{return reply({error:'SAVE_FAILED'},500);}
}
