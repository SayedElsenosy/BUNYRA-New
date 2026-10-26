import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '../../../lib/auth/current-user';
import {identity} from '../../../lib/bunyra/http';
import {overdueInstallments} from '../../../lib/bunyra/aging-report';
export const dynamic='force-dynamic';
const minor=(s:string)=>{const n=BigInt(s||'0');return (n/BigInt(100)).toString()+'.'+(n%BigInt(100)).toString().padStart(2,'0')};
export default async function AgingPage({searchParams}:{searchParams:Promise<{company?:string;page?:string}>}){
 const user=await getCurrentUser();if(!user)redirect('/auth');
 const q=await searchParams;
 if(!q.company)return <main className="treasury-page"><h1>تقرير أعمار الديون</h1><Link href="/treasury">اختر شركة من الخزينة</Link></main>;
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(q.company))return <main>معرف الشركة غير صالح</main>;
 const page=Math.max(1,Math.min(100000,Number.isSafeInteger(Number(q.page))?Number(q.page||1):1));
 const {sql,actor}=await identity();
 const data=await overdueInstallments(sql,actor,q.company,page);
 const pages=Math.max(1,Math.ceil(data.total/50));
 return <main className="treasury-page" dir="rtl">
  <header className="treasury-heading"><h1>تقرير أعمار الديون</h1><Link href={'/treasury?company='+q.company}>العودة للخزينة</Link></header>
  <p className="treasury-muted">الأقساط غير المسددة بعد تاريخ الاستحقاق — حسب توقيت القاهرة، بدون جمع عملات مختلفة.</p>
  <div className="treasury-table-scroll"><table className="treasury-table">
  <thead><tr><th>العميل</th><th>العملة</th><th>عدد الأقساط</th><th>1–30 يومًا</th><th>31–60 يومًا</th><th>أكثر من 60 يومًا</th><th>إجمالي المتأخرات</th></tr></thead>
  <tbody>{data.rows.map(r=><tr key={r.customer_id+'-'+r.currency_code}>
   <td>{r.customer_name}</td><td>{r.currency_code}</td><td>{r.installment_count}</td>
   <td>{minor(r.days_1_30_minor)}</td><td>{minor(r.days_31_60_minor)}</td>
   <td>{minor(r.over_60_minor)}</td><td><strong>{minor(r.total_minor)}</strong></td>
  </tr>)}
  {!data.rows.length&&<tr><td colSpan={7}>لا توجد أقساط متأخرة.</td></tr>}</tbody>
  </table></div>
  <footer className="treasury-pagination"><span>العملاء: {data.total} — صفحة {page} من {pages}</span>
   {page>1&&<Link href={'/reports/aging?company='+q.company+'&page='+(page-1)}>السابق</Link>}
   {page<pages&&<Link href={'/reports/aging?company='+q.company+'&page='+(page+1)}>التالي</Link>}
  </footer>
 </main>;
}
