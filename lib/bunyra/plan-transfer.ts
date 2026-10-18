import {z} from 'zod';
import {ServiceError,uuid,type Sql,type Actor} from './service';
import {writeAccess,planMetadata,identifyPlan,MAX_PLAN_BYTES,PLAN_CHUNK_BYTES,COMPANY_PLAN_BYTES} from './plan-files';
export type TransferStorage={
 begin:(key:string,mime:string)=>Promise<string>;
 part:(key:string,upload:string,part:number,data:Uint8Array)=>Promise<void>;
 parts:(key:string,upload:string)=>Promise<{number:number;size:number;etag:string}[]>;
 complete:(key:string,upload:string,parts:{number:number;etag:string}[])=>Promise<void>;
 abort:(key:string,upload:string)=>Promise<void>;
 head:(key:string)=>Promise<{size:number;etag:string}>;
 open:(key:string,range?:string)=>Promise<{body:ReadableStream;size:number;range?:string;etag:string}>;
};
export async function beginPlanTransfer(sql:Sql,actor:Actor,input:unknown,storage:TransferStorage,platform=false){
 const c=planMetadata.extend({size:z.number().int().min(8).max(MAX_PLAN_BYTES),header:z.array(z.number().int().min(0).max(255)).min(8).max(1024)}).parse(input);
 await writeAccess(sql,actor,c.company_id,c.project_id,platform);
 const kind=identifyPlan(c.original_name,new Uint8Array(c.header));
 // Expired incomplete uploads release quota only after their remote multipart upload is aborted.
 const expired=await sql`SELECT id,object_key,multipart_id FROM project_plan_files WHERE company_id=${c.company_id} AND status='uploading' AND upload_expires_at<now() LIMIT 20`;
 for(const row of expired){if(row.multipart_id)await storage.abort(row.object_key,row.multipart_id);await sql`UPDATE project_plan_files SET status='rejected' WHERE id=${row.id} AND company_id=${c.company_id} AND status='uploading' AND upload_expires_at<now()`;}
 const id=crypto.randomUUID(),key=`${c.company_id}/${c.project_id}/${id}.${kind.kind}`;
 const r=await sql.transaction([sql`SELECT id FROM companies WHERE id=${c.company_id} FOR UPDATE`,sql`INSERT INTO project_plan_files(id,company_id,project_id,title,building,floor,kind,original_name,object_key,byte_size,sha256,version,status,created_by,upload_expires_at) SELECT ${id},${c.company_id},${c.project_id},${c.title},${c.building},${c.floor},${kind.kind},${c.original_name},${key},${c.size},'multipart-etag',coalesce((SELECT max(version) FROM project_plan_files WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND building=${c.building} AND floor=${c.floor} AND kind=${kind.kind}),0)+1,'uploading',${actor.userId},now()+interval '24 hours' WHERE coalesce((SELECT sum(byte_size) FROM project_plan_files WHERE company_id=${c.company_id} AND status IN('uploading','ready')),0)+${c.size}<=${COMPANY_PLAN_BYTES} RETURNING id,version`]);
 if(!r[1].length)throw new ServiceError('STORAGE_QUOTA',409);
 try{const upload=await storage.begin(key,kind.mime);await sql`UPDATE project_plan_files SET multipart_id=${upload} WHERE id=${id} AND company_id=${c.company_id} AND status='uploading'`;}
 catch{await sql`UPDATE project_plan_files SET status='rejected' WHERE id=${id} AND company_id=${c.company_id}`;throw new ServiceError('STORAGE_UNAVAILABLE',503);}
 return {id,chunk_size:PLAN_CHUNK_BYTES,version:r[1][0].version};
}
async function scoped(sql:Sql,actor:Actor,company:string,project:string,id:string,platform:boolean){
 uuid.parse(id);await writeAccess(sql,actor,company,project,platform);
 const rows=await sql`SELECT id,object_key,multipart_id,kind,original_name,byte_size,status,object_etag,upload_expires_at>now() AS valid FROM project_plan_files WHERE company_id=${company} AND project_id=${project} AND id=${id}`;
 if(!rows.length)throw new ServiceError('NOT_FOUND',404);return rows[0];
}
export async function putPlanPart(sql:Sql,actor:Actor,company:string,project:string,id:string,part:number,bytes:Uint8Array,storage:TransferStorage,platform=false){
 const row=await scoped(sql,actor,company,project,id,platform);
 if(row.status!=='uploading'||!row.valid||!row.multipart_id)throw new ServiceError('UPLOAD_EXPIRED',409);
 const count=Math.ceil(row.byte_size/PLAN_CHUNK_BYTES);
 if(!Number.isInteger(part)||part<1||part>count||bytes.length!==(part===count?row.byte_size-PLAN_CHUNK_BYTES*(count-1):PLAN_CHUNK_BYTES))throw new ServiceError('INVALID_FILE_SIZE');
 if(part===1)identifyPlan(row.original_name,bytes);
 await storage.part(row.object_key,row.multipart_id,part,bytes);return {ok:true,part};
}
export async function completePlanTransfer(sql:Sql,actor:Actor,company:string,project:string,id:string,storage:TransferStorage,platform=false){
 const row=await scoped(sql,actor,company,project,id,platform);
 if(row.status==='ready')return {id,ok:true};
 if(row.status!=='uploading'||!row.valid||!row.multipart_id)throw new ServiceError('UPLOAD_EXPIRED',409);
 let head;
 try{head=await storage.head(row.object_key);}catch(e){if((e as {name?:string}).name!=='NotFound'&&(e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)throw e;}
 if(!head){
  const parts=(await storage.parts(row.object_key,row.multipart_id)).sort((a,b)=>a.number-b.number),count=Math.ceil(row.byte_size/PLAN_CHUNK_BYTES);
  if(parts.length!==count||parts.some((p,i)=>p.number!==i+1||p.size!==(i+1===count?row.byte_size-PLAN_CHUNK_BYTES*i:PLAN_CHUNK_BYTES)||!p.etag))throw new ServiceError('UPLOAD_INCOMPLETE',409);
  await storage.complete(row.object_key,row.multipart_id,parts);head=await storage.head(row.object_key);
 }
 if(head.size!==row.byte_size||!head.etag)throw new ServiceError('FILE_INTEGRITY',503);
 await sql`WITH changed AS(UPDATE project_plan_files SET status='ready',object_etag=${head.etag} WHERE company_id=${company} AND project_id=${project} AND id=${id} AND status='uploading' RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${company},${actor.userId},${actor.email},'project.plan_uploaded',to_jsonb(changed)-'object_key'-'multipart_id' FROM changed) SELECT id FROM changed`;
 return {id,ok:true};
}
export function validRange(range:string|undefined,size:number){
 if(!range)return undefined;
 const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))throw new ServiceError('INVALID_RANGE',416);
 const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2])),end=m[1]?(m[2]?Number(m[2]):size-1):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start||(!m[1]&&Number(m[2])===0))throw new ServiceError('INVALID_RANGE',416);
 return `bytes=${start}-${Math.min(end,size-1)}`;
}
export async function streamPlan(sql:Sql,actor:Actor,company:string,project:string,id:string,range:string|undefined,storage:TransferStorage,platform=false){
 const row=await scoped(sql,actor,company,project,id,platform);if(row.status!=='ready')throw new ServiceError('NOT_FOUND',404);
 const head=await storage.head(row.object_key);
 if(head.size!==row.byte_size||(row.object_etag&&head.etag!==row.object_etag))throw new ServiceError('FILE_INTEGRITY',503);
 const normalized=validRange(range,row.byte_size),file=await storage.open(row.object_key,normalized);
 if(file.etag!==head.etag||(normalized&&!file.range))throw new ServiceError('FILE_INTEGRITY',503);
 return {...file,name:row.original_name,kind:row.kind};
}
