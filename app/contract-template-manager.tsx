"use client";
import {useState} from "react";
type Template={id:string;name:string;file_name:string;file_size:number}|null;
export default function ContractTemplateManager({company,platform,initial}:{
 company:string;platform:boolean;initial:Template;
}){
 const [template,setTemplate]=useState(initial),[file,setFile]=useState<File|null>(null),
 [name,setName]=useState("عقد الشركة"),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const url="/api/contracts/templates"+(platform?"?mode=platform":"");
 async function upload(e:React.FormEvent){
  e.preventDefault();
  if(!file||file.size>5*1024*1024){setMessage("الملف مطلوب ويجب ألا يزيد عن 5MB.");return;}
  setBusy(true);setMessage("");
  try{
   const data=new FormData();data.set("company_id",company);data.set("name",name);data.set("file",file);
   const response=await fetch(url,{method:"POST",body:data});
   const body=await response.json();if(!response.ok)throw Error(body.error||"UPLOAD_FAILED");
   setTemplate({id:body.id,name:body.name,file_name:body.original_name,file_size:body.file_size});
   setFile(null);setMessage("تم تفعيل قالب Word بنجاح.");
  }catch(error){setMessage(error instanceof Error?error.message:"تعذر رفع القالب");}
  finally{setBusy(false);}
 }
 return <section className="panel">
  {template?<p role="status">القالب الحالي: <strong>{template.name}</strong> ({template.file_name}) — {Math.ceil(template.file_size/1024)} KB</p>:
   <p>لا يوجد قالب مفعّل لهذه الشركة.</p>}
  <a href={"/api/contracts/templates?company="+encodeURIComponent(company)+"&sample=1"+(platform?"&mode=platform":"")}
    className="primary" style={{display:"inline-block",marginBottom:18}}>تنزيل قالب Word تجريبي</a>
  <form onSubmit={upload} className="form-grid">
   <label>اسم القالب<input required minLength={1} maxLength={150} value={name} onChange={e=>setName(e.target.value)}/></label>
   <label>ملف Word (.docx) — 5MB
    <input required type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      onChange={e=>setFile(e.target.files?.[0]??null)}/>
   </label>
   <div><button className="primary" disabled={busy}>{busy?"جارٍ الرفع...":"رفع وتفعيل القالب"}</button></div>
  </form>
  {message&&<p role="status">{message}</p>}
 </section>;
}
