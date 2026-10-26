import Link from "next/link";
import {identity} from "../../lib/bunyra/http";
import {pagedRecords} from "../../lib/bunyra/paged-records";
import {uuid} from "../../lib/bunyra/service";
import {majorAmount} from "../../lib/bunyra/pricing-calculator";
import {RecordsPager,RecordsSearch} from "../records-pagination";
export const dynamic="force-dynamic";
export default async function ReceiptsList({searchParams}:{
 searchParams:Promise<{company?:string;page?:string;search?:string;mode?:string}>;
}){
 const p=await searchParams,company=uuid.parse(p.company),platform=p.mode==="platform";
 const {sql,actor}=await identity();
 const data=await pagedRecords(sql,actor,company,"receipts",{page:p.page,search:p.search,platform});
 return <main className="panel" style={{maxWidth:1000,margin:"2rem auto",padding:25}}>
  <Link href={platform?"/owner":"/company"}>← BUNYRA</Link><h1>الإيصالات</h1>
  <RecordsSearch path="/receipts" company={company} search={data.search} platform={platform}/>
  <div className="commercial-table">{data.rows.map(r=><div className="commercial-row" key={String(r.id)}>
   <span><strong>{r.contract_number} · {r.customer_name}</strong>
    <small>{r.reference_number} · {r.method} · {majorAmount(String(r.amount_minor))}</small></span>
   <Link href={"/contracts/"+r.contract_id+"?company="+company+(platform?"&mode=platform":"")}>العقد</Link>
  </div>)}</div>
  {!data.rows.length&&<p>لا توجد إيصالات مطابقة.</p>}
  <RecordsPager path="/receipts" company={company} search={data.search} page={data.page} total={data.total} platform={platform}/>
 </main>;
}
