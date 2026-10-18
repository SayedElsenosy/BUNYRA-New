import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {hasPermission} from './permissions';
import {MAX_PLAN_BYTES} from './plan-limits';
export {MAX_PLAN_BYTES,PLAN_CHUNK_BYTES,COMPANY_PLAN_BYTES} from './plan-limits';
export type PlanStorage={put:(key:string,data:Uint8Array,mime:string)=>Promise<void>;get:(key:string)=>Promise<Uint8Array>};
export const planMetadata=z.object({company_id:uuid,project_id:uuid,title:z.string().trim().min(1).max(160),building:z.string().trim().min(1).max(100),floor:z.string().trim().min(1).max(100),original_name:z.string().min(1).max(200)}).strict();
export function identifyPlan(name:string,bytes:Uint8Array){
 if(bytes.length<8||bytes.length>MAX_PLAN_BYTES)throw new ServiceError('INVALID_FILE_SIZE');
 const extension=name.toLowerCase().split('.').pop(),head=new TextDecoder().decode(bytes.slice(0,1024));
 if(extension==='pdf'&&head.startsWith('%PDF-'))return {kind:'pdf',mime:'application/pdf'};
 if(extension==='dwg'&&/^AC10\d{2}/.test(head))return {kind:'dwg',mime:'application/acad'};
 if(extension==='dxf'&&(/AutoCAD Binary DXF/.test(head)||/\bSECTION\b/.test(head)))return {kind:'dxf',mime:'application/dxf'};
 throw new ServiceError('UNSUPPORTED_FILE');
}
export async function writeAccess(sql:Sql,actor:Actor,company:string,project:string,platform:boolean){const ctx=await access(sql,actor,company,'projects.write',platform,project);if(!ctx.owner&&!['company_admin','operations'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);}
export async function listPlanFiles(sql:Sql,actor:Actor,company:string,project:string,platform=false){const ctx=await access(sql,actor,company,'projects.read',platform,project);const canWrite=(ctx.owner||['company_admin','operations'].includes(ctx.role))&&(ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'projects.write',project));return {can_write:canWrite,files:await sql`SELECT id,title,building,floor,kind,original_name,byte_size,version,created_at,status FROM project_plan_files WHERE company_id=${company} AND project_id=${project} AND ${canWrite} ORDER BY created_at DESC LIMIT 200`};}
export async function uploadPlan(sql:Sql,actor:Actor,input:unknown,bytes:Uint8Array,storage:PlanStorage,platform=false){
 const c=planMetadata.parse(input);await writeAccess(sql,actor,c.company_id,c.project_id,platform);
 const file=identifyPlan(c.original_name,bytes),id=crypto.randomUUID(),key=c.company_id+'/'+c.project_id+'/'+id+'.'+file.kind;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),b=>b.toString(16).padStart(2,'0')).join('');
 const pending=await sql.transaction([sql`SELECT id FROM companies WHERE id=${c.company_id} FOR UPDATE`,sql`INSERT INTO project_plan_files(id,company_id,project_id,title,building,floor,kind,original_name,object_key,byte_size,sha256,version,status,created_by) SELECT ${id},${c.company_id},${c.project_id},${c.title},${c.building},${c.floor},${file.kind},${c.original_name},${key},${bytes.length},${hash},coalesce((SELECT max(version) FROM project_plan_files WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND building=${c.building} AND floor=${c.floor} AND kind=${file.kind}),0)+1,'uploading',${actor.userId} WHERE coalesce((SELECT sum(byte_size) FROM project_plan_files WHERE company_id=${c.company_id} AND status IN('uploading','ready')),0)+${bytes.length}<=1073741824 RETURNING id,version`]);
 if(!pending[1].length)throw new ServiceError('STORAGE_QUOTA',409);
 try{await storage.put(key,bytes,file.mime);}catch{await sql`UPDATE project_plan_files SET status='rejected' WHERE company_id=${c.company_id} AND id=${id} AND status='uploading'`;throw new ServiceError('STORAGE_UNAVAILABLE',503);}
 await sql`WITH changed AS(UPDATE project_plan_files SET status='ready' WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND id=${id} AND status='uploading' RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'project.plan_uploaded',to_jsonb(changed)-'object_key' FROM changed) SELECT id FROM changed`;
 return {id,version:pending[1][0].version,kind:file.kind};
}
export async function downloadPlan(sql:Sql,actor:Actor,company:string,project:string,id:string,storage:PlanStorage,platform=false){uuid.parse(id);await writeAccess(sql,actor,company,project,platform);const rows=await sql`SELECT object_key,kind,original_name,sha256,byte_size FROM project_plan_files WHERE company_id=${company} AND project_id=${project} AND id=${id} AND status='ready'`;if(!rows.length)throw new ServiceError('NOT_FOUND',404);const row=rows[0],bytes=await storage.get(row.object_key);if(bytes.length!==row.byte_size)throw new ServiceError('FILE_INTEGRITY',503);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==row.sha256)throw new ServiceError('FILE_INTEGRITY',503);return {bytes,name:row.original_name,kind:row.kind};}
