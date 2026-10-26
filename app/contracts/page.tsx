import Link from "next/link";
import {identity} from "../../lib/bunyra/http";
import {pagedRecords} from "../../lib/bunyra/paged-records";
import {uuid} from "../../lib/bunyra/service";
import {majorAmount} from "../../lib/bunyra/pricing-calculator";
import {RecordsPager,RecordsSearch} from "../records-pagination";
export const dynamic="force-dynamic";
export default async function ContractsList({searchParams}:{
 searchParams:Promise<{company?:string;page?:string;search?:string;mode?:string}>;
}){
 const p=await searchParams,company=uuid.parse(p.company),platform=p.mode==="platform";
 const {sql,actor}=await identity();
 const data=await pagedRecords(sql,actor,company,"contracts",{page:p.page,search:p.search,platform});
 return <main className="panel" style={{maxWidth:1000,margin:"2rem auto",padding:25}}>
  <Link href={platform?"/owner":"/company"}>← BUNYRA</Link><h1>العقود</h1>
  <RecordsSearch path="/contracts" company={company} search={data.search} platform={platform}/>
  <div className="commercial-table">{data.rows.map(c=><div className="commercial-row" key={String(c.id)}>
   <span><strong>{c.contract_number} · {c.customer_name}</strong><small>{c.unit_code} · {majorAmount(String(c.value_final_minor))}</small></span>
   <span>{c.status}</span>
   <Link href={"/contracts/"+c.id+"?company="+company+(platform?"&mode=platform":"")}>تفاصيل العقد / Word</Link>
  </div>)}</div>
  {!data.rows.length&&<p>لا توجد عقود مطابقة.</p>}
  <RecordsPager path="/contracts" company={company} search={data.search} page={data.page} total={data.total} platform={platform}/>
 </main>;
}
