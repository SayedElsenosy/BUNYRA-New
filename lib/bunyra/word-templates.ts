import "server-only";
import {z} from "zod";
import PizZip from "pizzip";
import {renderWordTemplate,assertWordTemplate,sampleContractWord} from "./word-render.mjs";
export {sampleContractWord};
import {access,ServiceError,uuid,type Sql,type Actor} from "./service";
import {requireContract} from "./record-scope";
import {planStorage} from "./storage";
import {majorAmount} from "./pricing-calculator";

const MAX_BYTES=5*1024*1024;
export const wordContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
type Storage=ReturnType<typeof planStorage>;
const safeName=(s:string)=>s.replace(/[^\p{L}\p{N}._ -]/gu,"_").slice(0,140)||"contract.docx";
async function digest(data:Uint8Array){
 const hash=await crypto.subtle.digest("SHA-256",new Uint8Array(data));
 return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,"0")).join("");
}
function checkedZip(data:Uint8Array){
 if(data.length<250||data.length>MAX_BYTES)throw new ServiceError("INVALID_FILE_SIZE",413);
 if(data[0]!==80||data[1]!==75)throw new ServiceError("INVALID_DOCX",400);
 let zip:PizZip;try{zip=new PizZip(data);}catch{throw new ServiceError("INVALID_DOCX",400);}
 const paths=Object.keys(zip.files);
 if(paths.length>1500||!zip.file("word/document.xml")||!zip.file("[Content_Types].xml")||
  paths.some(p=>/vbaProject|\.bin$|embeddings\//i.test(p)))throw new ServiceError("INVALID_DOCX",400);
 return zip;
}
export async function activeWordTemplate(sql:Sql,actor:Actor,company:string,platform=false){
 await access(sql,actor,company,"company.read",platform);
 const rows=await sql`SELECT t.id,t.name,t.created_at,f.original_name,f.file_size,f.sha256,f.object_key
  FROM contract_templates t JOIN contract_template_files f ON f.company_id=t.company_id AND f.template_id=t.id
  WHERE t.company_id=${company} AND t.active ORDER BY t.created_at DESC,t.id DESC LIMIT 1`;
 return rows[0]??null;
}
export async function uploadWordTemplate(sql:Sql,actor:Actor,company:string,file:File,name:string,platform=false,storage:Storage=planStorage()){
 uuid.parse(company);await access(sql,actor,company,"company.write",platform);
 const title=z.string().trim().min(1).max(150).parse(name);
 if(file.size<1||file.size>MAX_BYTES)throw new ServiceError("INVALID_FILE_SIZE",413);
 if(!file.name.toLowerCase().endsWith(".docx"))throw new ServiceError("INVALID_DOCX",400);
 const bytes=new Uint8Array(await file.arrayBuffer());
 checkedZip(bytes);
 try{assertWordTemplate(bytes);}catch{throw new ServiceError('INVALID_DOCX_TEMPLATE',400);}
 const id=crypto.randomUUID(),fileId=crypto.randomUUID();
 const key=company+"/contracts/templates/"+id+".docx";
 const checksum=await digest(bytes);
 await storage.put(key,bytes,wordContentType);
 try{
  await sql.transaction([
   sql`UPDATE contract_templates SET active=false WHERE company_id=${company} AND active`,
   sql`INSERT INTO contract_templates(id,company_id,name,active,created_by)
        VALUES(${id},${company},${title},true,${actor.userId})`,
   sql`INSERT INTO contract_template_files(id,company_id,template_id,original_name,file_size,sha256,object_key)
        VALUES(${fileId},${company},${id},${safeName(file.name)},${bytes.length},${checksum},${key})`,
   sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
        VALUES(${company},${actor.userId},${actor.email},'contract_template.uploaded',
               jsonb_build_object('template_id',${id}::text,'sha256',${checksum},'size',${bytes.length}::integer))`,
  ]);
 }catch(error){await storage.remove(key).catch(()=>{});throw error;}
 return {id,name:title,original_name:file.name,file_size:bytes.length};
}
type ContractWordSnapshot={
 contract_number:string;signed_date:string;status:string;value_final_minor:string;currency:string;
 customer_name:string;customer_phone:string;customer_email:string;correspondence_address:string;
 national_id:string;unit_code:string;unit_area:string;project_name:string;
 installments:Array<{number:number;due_date:string;amount_minor:string;paid_minor:string;status:string}>;
};
type ContractWordFile={object_key:string;sha256:string;file_size:number;original_name:string};
async function issuedWordFile(sql:Sql,company:string,id:string){
 const [file]=await sql`SELECT object_key,sha256,file_size,original_name FROM contract_word_files
  WHERE company_id=${company} AND contract_id=${id}`;
 return file as ContractWordFile|undefined;
}
async function readIssuedWord(file:ContractWordFile,storage:Storage){
 const bytes=await storage.get(file.object_key);
 if(bytes.length!==file.file_size||await digest(bytes)!==file.sha256)throw new ServiceError("FILE_INTEGRITY",503);
 return {bytes,name:file.original_name};
}
export async function downloadContractWord(sql:Sql,actor:Actor,company:string,id:string,platform=false,storage:Storage=planStorage()){
 uuid.parse(company);uuid.parse(id);
 // Authorization is rechecked on every download, including cached issued files.
 await requireContract(sql,actor,company,id,"bookings.read",platform);
 const issued=await issuedWordFile(sql,company,id);
 if(issued)return readIssuedWord(issued,storage);
 const [snapshot]=await sql`SELECT template_object_key,template_sha256,template_file_size,data_snapshot
  FROM contract_word_snapshots WHERE company_id=${company} AND contract_id=${id}`;
 if(!snapshot)throw new ServiceError("CONTRACT_WORD_SNAPSHOT_REQUIRED",409);
 if(!snapshot.template_object_key)throw new ServiceError("TEMPLATE_NOT_CONFIGURED_AT_SIGNING",409);
 const row=snapshot.data_snapshot as ContractWordSnapshot;
 if(!row||!Array.isArray(row.installments)||!row.installments.length)
  throw new ServiceError("CONTRACT_WORD_SNAPSHOT_INVALID",409);
 const bytes=await storage.get(snapshot.template_object_key);
 if(bytes.length!==snapshot.template_file_size||await digest(bytes)!==snapshot.template_sha256)
  throw new ServiceError("FILE_INTEGRITY",503);
 checkedZip(bytes);
 let result:Uint8Array;
 try{
  result=renderWordTemplate(bytes,{
   contract_number:row.contract_number,signed_date:row.signed_date,
   contract_status:row.status,customer_name:row.customer_name,customer_phone:row.customer_phone,
   customer_email:row.customer_email,customer_national_id:row.national_id,
   customer_address:row.correspondence_address,project_name:row.project_name,
   unit_number:row.unit_code,unit_area:row.unit_area,
   contract_value:majorAmount(row.value_final_minor),currency:row.currency,
   installments:row.installments.map(i=>({number:i.number,due_date:i.due_date,
    amount:majorAmount(i.amount_minor),paid:majorAmount(i.paid_minor),status:i.status})),
  });
 }catch{
  throw new ServiceError("TEMPLATE_RENDER_FAILED",422);
 }
 if(result.length>10*1024*1024)throw new ServiceError("INVALID_FILE_SIZE",413);
 const key=company+"/contracts/issued/"+id+"/"+crypto.randomUUID()+".docx";
 const checksum=await digest(result),name="BUNYRA-Contract-"+safeName(row.contract_number)+".docx";
 // Every contender uses its own key; it can never overwrite the winner's bytes.
 await storage.put(key,result,wordContentType);
 await sql.transaction([
  sql`INSERT INTO contract_word_files(company_id,contract_id,object_key,sha256,file_size,original_name,generated_by)
   VALUES(${company},${id},${key},${checksum},${result.length},${name},${actor.userId})
   ON CONFLICT(company_id,contract_id) DO NOTHING`,
  sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
   SELECT ${company},${actor.userId},${actor.email},'contract.word_issued',
    jsonb_build_object('contract_id',${id}::text,'sha256',${checksum})
   FROM contract_word_files WHERE company_id=${company} AND contract_id=${id} AND object_key=${key}`,
 ]);
 // A separate query sees a concurrent winner after INSERT's conflict wait.
 const winner=await issuedWordFile(sql,company,id);
 if(!winner)throw new ServiceError("SERVICE_UNAVAILABLE",503);
 if(winner.object_key===key)return {bytes:result,name};
 await storage.remove(key).catch(()=>{});
 return readIssuedWord(winner,storage);
}
