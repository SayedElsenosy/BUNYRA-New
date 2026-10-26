import Link from 'next/link';
import {redirect} from 'next/navigation';
import {z} from 'zod';
import {getCurrentUser} from '../../lib/auth/current-user';
import {identity} from '../../lib/bunyra/http';
import {treasuryReceipts} from '../../lib/bunyra/treasury-reports';
import {ChequeActions} from '../receipt-cheque-actions';
export const dynamic='force-dynamic';
const schema=z.object({company:z.string().uuid(),page:z.coerce.number().int().min(1).max(100000).default(1),
 type:z.enum(['ALL','CHEQUE','CASH','BANK_TRANSFER','UNSPECIFIED']).default('ALL'),
 status:z.enum(['ALL','PENDING','CLEARED','BOUNCED']).default('ALL'),
 from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
 to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()});
const minor=(s:string)=>{const n=BigInt(s||'0');return (n/BigInt(100)).toString()+'.'+(n%BigInt(100)).toString().padStart(2,'0')};
export default async function TreasuryPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const user=await getCurrentUser();if(!user)redirect('/auth');
 const {sql,actor}=await identity(),search=await searchParams;
 const companies=await sql`SELECT c.id,c.name FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.user_id=${actor.userId} AND m.active AND c.status='active' ORDER BY c.name`;
 if(!search.company)return <main className="treasury-page" dir="rtl"><h1>خزينة BUNYRA</h1><p>اختر الشركة لعرض بيانات الخزينة.</p>{companies.map(c=><p key={c.id}><Link href={'/treasury?company='+c.id}>{c.name}</Link></p>)}</main>;
 const parsed=schema.safeParse(search);
 if(!parsed.success)return <main className="treasury-page" dir="rtl"><h1>بيانات التصفية غير صحيحة</h1><Link href="/treasury">عودة</Link></main>;
 const f=parsed.data;
 const data=await treasuryReceipts(sql,actor,{...f,from:f.from??null,to:f.to??null});
 const pageLink=(p:number)=>{const query=new URLSearchParams({company:f.company,page:String(p),type:f.type,status:f.status});if(f.from)query.set('from',f.from);if(f.to)query.set('to',f.to);return '/treasury?'+query.toString()};
 const pages=Math.max(1,Math.ceil(data.total/20));
 return <main className="treasury-page" dir="rtl">
  <header className="treasury-heading"><h1>الخزينة والإيصالات</h1><nav><Link href={'/reports/aging?company='+f.company}>تقرير أعمار الديون</Link><Link href={'/?company='+f.company+'&view=receipts'}>إصدار شيك جديد</Link></nav></header>
  <div className="treasury-metrics">
   <article><p>مقبوضات اليوم</p>{data.today.length?data.today.map(row=><strong key={row.currency_code}>{minor(row.amount_minor)} {row.currency_code} </strong>):<strong>0.00</strong>}</article>
   <article><p>الشيكات تحت التحصيل</p><strong>{data.pending}</strong></article>
   <article><p>الشيكات المرتجعة</p><strong>{data.bounced}</strong></article>
  </div>
  <form method="GET" className="treasury-filters">
   <input type="hidden" name="company" value={f.company}/>
   <label>نوع الإيصال<select name="type" defaultValue={f.type}>{['ALL','CHEQUE','CASH','BANK_TRANSFER','UNSPECIFIED'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
   <label>الحالة<select name="status" defaultValue={f.status}>{['ALL','PENDING','CLEARED','BOUNCED'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
   <label>من تاريخ<input type="date" name="from" defaultValue={f.from||''}/></label><label>إلى تاريخ<input type="date" name="to" defaultValue={f.to||''}/></label>
   <button type="submit">بحث</button>
  </form>
  <div className="treasury-table-scroll"><table className="treasury-table"><thead><tr><th>التاريخ</th><th>العميل</th><th>العقد</th><th>النوع</th><th>القيمة</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
   {data.receipts.map(r=><tr key={r.id}><td>{r.created_at.slice(0,10)}</td><td>{r.customer_name}</td><td>{r.contract_number}</td>
    <td>{r.method}</td><td dir="ltr">{minor(r.amount_minor)} {r.currency_code}</td><td>{r.cheque_state}</td>
    <td>{data.canWrite&&r.method==='CHEQUE'&&r.cheque_state==='PENDING'?
     <ChequeActions id={r.id} company={f.company} currency={r.currency_code} accounts={data.accounts.map(a=>({id:a.id,name:a.name,currency_code:a.currency_code}))}/>:null}</td></tr>)}
   {!data.receipts.length&&<tr><td colSpan={7}>لا توجد إيصالات تطابق التصفية.</td></tr>}
  </tbody></table></div>
  <footer className="treasury-pagination"><span>النتائج: {data.total} — صفحة {f.page} من {pages}</span>
   {f.page>1&&<Link href={pageLink(f.page-1)}>السابق</Link>}
   {f.page<pages&&<Link href={pageLink(f.page+1)}>التالي</Link>}
  </footer>
 </main>;
}
