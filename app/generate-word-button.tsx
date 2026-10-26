"use client";
import {useState} from "react";
export default function GenerateWordButton({company,id,platform=false}:{
 company:string;id:string;platform?:boolean;
}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function download(){
  if(busy)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/contracts/"+encodeURIComponent(id)+"/generate-docx"+(platform?"?mode=platform":""),{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({company_id:company}),
   });
   if(!response.ok){const e=await response.json().catch(()=>({}));
    throw new Error(e.error==="TEMPLATE_NOT_CONFIGURED"?"لم يتم رفع قالب Word للشركة بعد.":e.error||"تعذر إنشاء العقد");}
   const blob=await response.blob();
   const location=URL.createObjectURL(blob);
   const a=document.createElement("a");
   a.href=location;
   a.download="BUNYRA-Contract.docx";
   document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(location),60000);
  }catch(e){setError(e instanceof Error?e.message:"تعذر التحميل");}
  finally{setBusy(false);}
 }
 return <div><button type="button" disabled={busy} onClick={download}
 className="primary">{busy?"جارٍ تجهيز العقد...":"تحميل العقد (Word)"}</button>
 {error&&<p role="alert" className="muted">{error}</p>}</div>;
}
