import Link from "next/link";
import {identity} from "../../lib/bunyra/http";
import {pagedRecords} from "../../lib/bunyra/paged-records";
import {uuid} from "../../lib/bunyra/service";
import {RecordsPager,RecordsSearch} from "../records-pagination";
export const dynamic="force-dynamic";
export default async function CustomersList({searchParams}:{
 searchParams:Promise<{company?:string;page?:string;search?:string;mode?:string}>;
}){
 const p=await searchParams,company=uuid.parse(p.company),platform=p.mode==="platform";
 const {sql,actor}=await identity();
 const data=await pagedRecords(sql,actor,company,"customers",{page:p.page,search:p.search,platform});
 return <main className="panel" style={{maxWidth:1000,margin:"2rem auto",padding:25}}>
  <Link href={platform?"/owner":"/company"}>← BUNYRA</Link><h1>العملاء · CRM</h1>
  <RecordsSearch path="/customers" company={company} search={data.search} platform={platform}/>
  <div className="commercial-table">{data.rows.map(c=><div className="commercial-row" key={String(c.id)}>
   <span><strong>{c.full_name}</strong><small dir="ltr">{c.phone_primary} · {c.email}</small></span>
   <Link href={"/customers/"+c.id+"?company="+company+(platform?"&mode=platform":"")}>Customer 360 ←</Link>
  </div>)}</div>
  {!data.rows.length&&<p>لا توجد نتائج مطابقة.</p>}
  <RecordsPager path="/customers" company={company} search={data.search} page={data.page} total={data.total} platform={platform}/>
 </main>;
}
