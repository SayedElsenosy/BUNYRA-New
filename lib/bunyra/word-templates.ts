import "server-only";
import {z} from "zod";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
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
export async function downloadContractWord(sql:Sql,actor:Actor,company:string,id:string,platform=false,storage:Storage=planStorage()){
 uuid.parse(company);uuid.parse(id);
 const contract=await requireContract(sql,actor,company,id,"bookings.read",platform);
 const [template]=await sql`SELECT f.object_key,f.sha256,f.file_size
  FROM contract_templates t JOIN contract_template_files f ON f.company_id=t.company_id AND f.template_id=t.id
  WHERE t.company_id=${company} AND t.active LIMIT 1`;
 if(!template)throw new ServiceError("TEMPLATE_NOT_CONFIGURED",404);
 const [row]=await sql`SELECT c.contract_number,c.status,c.value_final_minor,c.signed_at,c.payment_plan_snapshot,
    b.customer_name,b.customer_phone,b.customer_email,b.correspondence_address,
    u.code AS unit_code,u.area::text AS unit_area,p.name AS project_name,cr.national_id
    FROM contracts c JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
    JOIN crm_customers cr ON cr.company_id=c.company_id AND cr.id=c.customer_id
    JOIN inventory_units u ON u.company_id=c.company_id AND u.id=c.unit_id
    JOIN projects p ON p.company_id=c.company_id AND p.id=c.project_id
    WHERE c.company_id=${company} AND c.id=${contract.id} LIMIT 1`;
 if(!row)throw new ServiceError("NOT_FOUND",404);
 const installments=await sql`SELECT number,due_date::text AS due_date,amount_minor::text,paid_minor::text,status
    FROM contract_installments WHERE company_id=${company} AND contract_id=${id} ORDER BY number,id`;
 const bytes=await storage.get(template.object_key);
 if(bytes.length!==template.file_size||await digest(bytes)!==template.sha256)throw new ServiceError("FILE_INTEGRITY",503);
 const zip=checkedZip(bytes);
 try{
  const doc=new Docxtemplater(zip,{paragraphLoop:true,linebreaks:true,throwOnUndefined:false});
  doc.render({
   contract_number:row.contract_number,signed_date:new Date(String(row.signed_at)).toISOString().slice(0,10),
   contract_status:row.status,customer_name:row.customer_name,customer_phone:row.customer_phone,
   customer_email:row.customer_email,customer_national_id:row.national_id??"",
   customer_address:row.correspondence_address,project_name:row.project_name,
   unit_number:row.unit_code,unit_area:row.unit_area,
   contract_value:majorAmount(String(row.value_final_minor)),
   currency:((row.payment_plan_snapshot as {book?:{currency?:string}}|null)?.book?.currency??"EGP"),
   installments:installments.map(i=>({number:i.number,due_date:i.due_date,
    amount:majorAmount(String(i.amount_minor)),paid:majorAmount(String(i.paid_minor)),status:i.status})),
  });
  const result=doc.getZip().generate({type:"uint8array",compression:"DEFLATE"});
  return {bytes:result,name:"BUNYRA-Contract-"+safeName(String(row.contract_number))+".docx"};
 }catch(error){console.error("DOCX render error",error instanceof Error?error.message:"Invalid template");
  throw new ServiceError("TEMPLATE_RENDER_FAILED",422);}
}
export function sampleContractWord(){
 const zip=new PizZip();
 const items=[
 "BUNYRA | Contract {contract_number}",
 "Date: {signed_date}",
 "Customer: {customer_name} | Phone: {customer_phone}",
 "National ID: {customer_national_id}",
 "Project: {project_name} | Unit: {unit_number} | Area: {unit_area}",
 "Contract value: {contract_value} {currency}",
 "{#installments}Installment {number}: {amount} due {due_date}{/installments}",
 ];
 const paragraphs=items.map(s=>"<w:p><w:r><w:t xml:space=\"preserve\">"+s+"</w:t></w:r></w:p>").join("");
 zip.file("word/document.xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
 '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+paragraphs+'<w:sectPr/></w:body></w:document>');
 zip.file("[Content_Types].xml",'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
 '<Default Extension="xml" ContentType="application/xml"/>'+
 '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"/></Types>');
 zip.file("_rels/.rels",'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 return zip.generate({type:"uint8array",compression:"DEFLATE"});
}
