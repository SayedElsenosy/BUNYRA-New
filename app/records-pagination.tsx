import Link from "next/link";
export function RecordsPager({path,company,page,total,search,platform=false}:{
 path:string;company:string;page:number;total:number;search:string;platform?:boolean;
}){
 const pages=Math.max(1,Math.ceil(total/20));
 const url=(n:number)=>path+"?"+new URLSearchParams({
  company,...(platform?{mode:"platform"}:{}),...(search?{search}:{}),page:String(n),
 }).toString();
 return <nav aria-label="ترقيم الصفحات" className="row-actions" style={{display:"flex",justifyContent:"space-between",gap:15,marginTop:20}}>
  <span>{total===0?0:(page-1)*20+1}–{Math.min(total,page*20)} من {total} · صفحة {page} / {pages}</span>
  <div style={{display:"flex",gap:12}}>
   {page>1?<Link href={url(page-1)}>← السابق</Link>:<span>السابق</span>}
   {page<pages?<Link href={url(page+1)}>التالي →</Link>:<span>التالي</span>}
  </div>
 </nav>;
}
export function RecordsSearch({company,path,search,platform=false}:{
 company:string;path:string;search:string;platform?:boolean;
}){
 return <form action={path} method="get" role="search" className="compact-form">
  <input type="hidden" name="company" value={company}/>
  {platform&&<input type="hidden" name="mode" value="platform"/>}
  <input type="search" aria-label="بحث في السجلات" name="search" defaultValue={search} maxLength={120} placeholder="بحث بالاسم أو الرقم"/>
  <button className="primary" type="submit">بحث</button>
 </form>;
}
