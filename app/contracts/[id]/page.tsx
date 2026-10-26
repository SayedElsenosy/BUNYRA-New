import Link from "next/link";
import {identity} from "../../../lib/bunyra/http";
import {requireContract} from "../../../lib/bunyra/record-scope";
import {uuid} from "../../../lib/bunyra/service";
import {majorAmount} from "../../../lib/bunyra/pricing-calculator";
import GenerateWordButton from "../../generate-word-button";
export const dynamic="force-dynamic";
export default async function ContractDetail({params,searchParams}:{
 params:Promise<{id:string}>;searchParams:Promise<{company?:string;mode?:string}>;
}){
 const [{id},p]=await Promise.all([params,searchParams]);
 const company=uuid.parse(p.company),platform=p.mode==="platform";
 const {sql,actor}=await identity();
 await requireContract(sql,actor,company,uuid.parse(id),"bookings.read",platform);
 const [c]=await sql`SELECT c.id,c.contract_number,c.status,c.value_final_minor::text AS value_final_minor,
    c.signed_at,b.customer_name,b.customer_phone,b.customer_email,u.code AS unit_code,
    pr.name AS project_name FROM contracts c
    JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
    JOIN inventory_units u ON u.company_id=c.company_id AND u.id=c.unit_id
    JOIN projects pr ON pr.company_id=c.company_id AND pr.id=c.project_id
    WHERE c.company_id=${company} AND c.id=${id} LIMIT 1`;
 const installments=await sql`SELECT number,due_date::text AS due_date,amount_minor::text,paid_minor::text,status
 FROM contract_installments WHERE company_id=${company} AND contract_id=${id} ORDER BY number,id LIMIT 500`;
 return <main className="panel" style={{maxWidth:980,margin:"2rem auto",padding:25}}>
  <Link href={"/contracts?company="+company+(platform?"&mode=platform":"")}>← كل العقود</Link>
  <h1>تفاصيل العقد {String(c.contract_number)}</h1>
  <p>{c.project_name} — الوحدة {c.unit_code}</p>
  <div className="commercial-stats">
   <div><span>العميل</span><strong>{c.customer_name}</strong></div>
   <div><span>الهاتف عند التعاقد</span><strong>{c.customer_phone}</strong></div>
   <div><span>قيمة العقد</span><strong>{majorAmount(String(c.value_final_minor))}</strong></div>
   <div><span>الحالة</span><strong>{c.status}</strong></div>
  </div>
  <GenerateWordButton company={company} id={id} platform={platform}/>
  <h2>جدول الأقساط</h2>
  <div className="commercial-table">{installments.map(i=><div className="commercial-row" key={String(i.number)}>
    <strong>قسط {i.number}</strong><span>{i.due_date}</span>
    <span>{majorAmount(String(i.amount_minor))}</span><span>{i.status}</span>
  </div>)}</div>
  <Link href={"/settings/contracts?company="+company+(platform?"&mode=platform":"")}>إدارة قالب Word</Link>
 </main>;
}
