import Link from "next/link";
import {identity} from "../../../lib/bunyra/http";
import {customerJourney} from "../../../lib/bunyra/customer-journey";
import {uuid} from "../../../lib/bunyra/service";
export const dynamic="force-dynamic";
export default async function CustomerDetail({params,searchParams}:{
 params:Promise<{id:string}>;
 searchParams:Promise<{company?:string;tab?:string;page?:string;mode?:string}>;
}){
 const [{id},p]=await Promise.all([params,searchParams]);
 const company=uuid.parse(p.company),customer=uuid.parse(id),platform=p.mode==="platform";
 const {sql,actor}=await identity();
 const query={company,customer,tab:p.tab||"activity",page:p.page||"0"};
 const data=await customerJourney(sql,actor,query,platform);
 const c=data.customer as {full_name:string;phone:string;email:string};
 const where=(tab:string,page=0)=>"/customers/"+id+"?"+new URLSearchParams({
  company,tab,page:String(page),...(platform?{mode:"platform"}:{})
 }).toString();
 const total=Number(data.counts[query.tab]||0);
 return <main className="panel" style={{maxWidth:1000,margin:"2rem auto",padding:25}}>
  <Link href={"/customers?company="+company+(platform?"&mode=platform":"")}>← قائمة العملاء</Link>
  <h1>Customer 360 · {c.full_name}</h1><p>{c.phone} · {c.email}</p>
  <nav className="row-actions" aria-label="أقسام ملف العميل" style={{display:"flex",gap:16,flexWrap:"wrap"}}>
   {data.tabs.map(tab=><Link key={tab} href={where(tab)} aria-current={query.tab===tab?"page":undefined}>
    {({activity:"النشاط",followups:"المتابعات",requests:"طلبات العملاء",offers:"العروض",bookings:"الحجوزات",contracts:"العقود",collections:"التحصيلات"} as Record<string,string>)[tab]||tab}
   </Link>)}
  </nav>
  <section className="commercial-table">{data.rows.map(r=><div className="commercial-row" key={String(r.id)+String(r.section)}>
    <span><strong>{r.title}</strong><small>{r.body} · {r.status}</small></span>
    {r.view==="contracts"?<Link href={"/contracts/"+r.record+"?company="+company+(platform?"&mode=platform":"")}>عرض العقد</Link>:<small>{new Date(String(r.at)).toLocaleDateString("ar-EG")}</small>}
  </div>)}</section>
  {!data.rows.length&&<p>لا توجد سجلات في القسم الحالي.</p>}
  <nav style={{display:"flex",gap:16,marginTop:20}}>
    {data.page>0&&<Link href={where(query.tab,data.page-1)}>← السابق</Link>}
    <span>{data.page*20+1}–{Math.min(total,(data.page+1)*20)} من {total}</span>
    {(data.page+1)*20<total&&<Link href={where(query.tab,data.page+1)}>التالي →</Link>}
  </nav>
 </main>;
}
