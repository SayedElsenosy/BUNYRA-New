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
    const messages:Record<string,string>={
     TEMPLATE_NOT_CONFIGURED:"لم يتم رفع قالب Word للشركة بعد.",
     CONTRACT_WORD_SNAPSHOT_REQUIRED:"هذا العقد أقدم من نظام حفظ النسخ الثابتة. يلزم مراجعة النسخة الأصلية؛ لا يمكن إعادة إنشائها من البيانات الحالية.",
     TEMPLATE_NOT_CONFIGURED_AT_SIGNING:"لم يكن هناك قالب محفوظ وقت التعاقد. يلزم إصدار تعاقدي معتمد بدل إنشاء نسخة بأثر رجعي.",
     CONTRACT_WORD_SNAPSHOT_INVALID:"بيانات نسخة التعاقد غير مكتملة. راجع المسؤول عن العقود.",
     FILE_INTEGRITY:"تعذر التحقق من سلامة ملف العقد المحفوظ. تواصل مع المسؤول.",
    };
    throw new Error(messages[e.error]||"تعذر تحميل نسخة العقد. حاول مجددًا أو تواصل مع المسؤول");}
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
