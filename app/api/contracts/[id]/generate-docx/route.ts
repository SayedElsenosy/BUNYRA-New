import {identity,sameOrigin,failure,json} from "../../../../../lib/bunyra/http";
import {downloadContractWord,wordContentType} from "../../../../../lib/bunyra/word-templates";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  sameOrigin(request);
  if(Number(request.headers.get("content-length")||0)>1024)return json({error:"INVALID_INPUT"},413);
  const {id}=await params,{sql,actor}=await identity();
  const payload=await request.json() as {company_id?:unknown};
  if(!payload||typeof payload.company_id!=="string")return json({error:"INVALID_INPUT"},400);
  const platform=new URL(request.url).searchParams.get("mode")==="platform";
  const result=await downloadContractWord(sql,actor,payload.company_id,id,platform);
  // Return actual DOCX bytes, not a persisted PDF/offer or unaudited file pointer.
  return new Response(new Uint8Array(result.bytes),{
   headers:{
    "Content-Type":wordContentType,
    "Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(result.name),
    "Content-Length":String(result.bytes.length),
    "Cache-Control":"private, no-store",
    "X-Content-Type-Options":"nosniff",
   }
  });
 }catch(error){return failure(error);}
}
