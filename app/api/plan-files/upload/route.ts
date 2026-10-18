import {identity,sameOrigin,json,failure} from '../../../../lib/bunyra/http';
import {beginPlanTransfer,putPlanPart,completePlanTransfer} from '../../../../lib/bunyra/plan-transfer';
import {PLAN_CHUNK_BYTES} from '../../../../lib/bunyra/plan-files';
import {planStorage} from '../../../../lib/bunyra/storage';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 sameOrigin(request);const {sql,actor}=await identity(),u=new URL(request.url),platform=u.searchParams.get('mode')==='platform';
 const storage=planStorage();
 if(Number(request.headers.get('content-length')||0)>8192)return json({error:'INVALID_FILE_SIZE'},413);
 const reader=request.body?.getReader();if(!reader)return json({error:'VALIDATION_ERROR'},400);
 let size=0;const pieces:Uint8Array[]=[];while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>8192){await reader.cancel();return json({error:'INVALID_FILE_SIZE'},413);}pieces.push(r.value);}
 const payload=new Uint8Array(size);let at=0;for(const p of pieces){payload.set(p,at);at+=p.length;}
 const c=JSON.parse(new TextDecoder().decode(payload));
 if(c.operation==='begin'){const {operation,...metadata}=c;return json(await beginPlanTransfer(sql,actor,metadata,storage,platform));}
 if(c.operation==='complete')return json(await completePlanTransfer(sql,actor,c.company_id,c.project_id,c.id,storage,platform));
 return json({error:'VALIDATION_ERROR'},400);
}catch(e){return failure(e);}}
export async function PUT(request:Request){try{
 sameOrigin(request);const {sql,actor}=await identity(),u=new URL(request.url);
 // Each request holds at most 5 MiB, even when the complete original is 100 MiB.
 const reader=request.body?.getReader();if(!reader)return json({error:'INVALID_FILE_SIZE'},400);
 if(Number(request.headers.get('content-length')||0)>PLAN_CHUNK_BYTES)return json({error:'INVALID_FILE_SIZE'},413);
 let size=0;const chunks:Uint8Array[]=[];while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>PLAN_CHUNK_BYTES){await reader.cancel();return json({error:'INVALID_FILE_SIZE'},413);}chunks.push(r.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return json(await putPlanPart(sql,actor,u.searchParams.get('company')||'',u.searchParams.get('project')||'',u.searchParams.get('id')||'',Number(u.searchParams.get('part')),bytes,planStorage(),u.searchParams.get('mode')==='platform'));
}catch(e){return failure(e);}}
