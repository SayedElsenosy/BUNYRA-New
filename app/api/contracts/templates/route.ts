import {identity,sameOrigin,json,failure} from "../../../../lib/bunyra/http";
import {activeWordTemplate,sampleContractWord,uploadWordTemplate,wordContentType} from "../../../../lib/bunyra/word-templates";
import {access} from "../../../../lib/bunyra/service";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity(),url=new URL(request.url);
  const company=url.searchParams.get("company")||"",platform=url.searchParams.get("mode")==="platform";
  if(url.searchParams.get("sample")==="1"){
   await access(sql,actor,company,"company.write",platform);
   const bytes=sampleContractWord();
   return new Response(new Uint8Array(bytes),{headers:{
    "Content-Type":wordContentType,
    "Content-Disposition":'attachment; filename="BUNYRA-Sample-Contract.docx"',
    "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"
   }});
  }
  const template=await activeWordTemplate(sql,actor,company,platform);
  if(template)delete template.object_key;
  return json({template});
 }catch(error){return failure(error);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);
  if(Number(request.headers.get("content-length")||0)>5*1024*1024+65536)return json({error:"INVALID_FILE_SIZE"},413);
  const {sql,actor}=await identity(),platform=new URL(request.url).searchParams.get("mode")==="platform";
  const form=await request.formData(),company=String(form.get("company_id")||""),
   name=String(form.get("name")||""),file=form.get("file");
  if(!(file instanceof File))return json({error:"FILE_REQUIRED"},400);
  return json(await uploadWordTemplate(sql,actor,company,file,name,platform),201);
 }catch(error){return failure(error);}
}
