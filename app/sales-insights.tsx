'use client';
import {CartesianGrid,Legend,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
type Trend={period:string;calls:number;followups:number;completed_followups:number;bookings:number;sales:number};
type Representative={user_id:string;salesperson:string;calls:number;followups:number;completed_followups:number;bookings:number;sales:number};
export type SalesVisualData={trend:Trend[];representatives:Representative[];representatives_total:number};
export default function SalesInsights({data,en}:{data:SalesVisualData;en:boolean}){
 const t=(ar:string,eng:string)=>en?eng:ar;
 const chart=data.trend.map(row=>({date:row.period,calls:Number(row.calls),bookings:Number(row.bookings),sales:Number(row.sales)}));
 const top=data.representatives.slice(0,10);
 const count=(n:number)=>n.toLocaleString(en?'en-GB':'ar-EG');
 return <div className="sales-visuals">
  <section className="sales-visual-card" aria-label={t('اتجاه نشاط المبيعات','Sales activity trend')}>
   <div className="sales-visual-heading"><div><h3>{t('حركة المبيعات خلال الفترة','Sales activity over time')}</h3><p>{t('المكالمات المسجلة وطلبات الحجز والعقود غير الملغاة، حسب التجميع المختار.','Recorded calls, booking requests and non-cancelled contracts by the selected period.')}</p></div><span className="sales-visual-note">{count(chart.length)} {t('فترة لها نشاط','active periods')}</span></div>
   {chart.length>0?<div role="img" aria-label={t('رسم يوضح المكالمات والحجوزات والعقود للفترات المسجلة؛ نفس الأعداد متاحة في جدول التقرير أدناه.','Chart of calls, bookings and contracts for reported periods; all data is also in the report table below.')}>
    <ResponsiveContainer width="100%" height={265}>
     <LineChart data={chart} margin={{top:14,right:12,bottom:4,left:4}} accessibilityLayer>
      <CartesianGrid stroke="var(--line)" strokeDasharray="4 5" vertical={false}/>
      <XAxis dataKey="date" tickFormatter={(value:string)=>value.slice(5)} tick={{fill:'var(--muted)',fontSize:11}} tickLine={false} axisLine={false} minTickGap={24}/>
      <YAxis allowDecimals={false} tick={{fill:'var(--muted)',fontSize:11}} tickLine={false} axisLine={false} width={34}/>
      <Tooltip contentStyle={{background:'var(--surface)',color:'var(--ink)',borderColor:'var(--line)',borderRadius:12}} labelStyle={{color:'var(--ink)'}}/>
      <Legend verticalAlign="top" wrapperStyle={{fontSize:12,paddingBottom:14}}/>
      <Line type="monotone" dataKey="calls" name={t('مكالمات','Calls')} stroke="var(--primary)" strokeWidth={2.5} dot={false} activeDot={{r:5}}/>
      <Line type="monotone" dataKey="bookings" name={t('طلبات حجز','Bookings')} stroke="var(--green)" strokeWidth={2.5} dot={false} activeDot={{r:5}}/>
      <Line type="monotone" dataKey="sales" name={t('عقود','Contracts')} stroke="var(--ink)" strokeWidth={2.5} dot={false} activeDot={{r:5}}/>
     </LineChart>
    </ResponsiveContainer>
   </div>:<p className="sales-visual-empty">{t('لا توجد أنشطة في الفترة والنطاق المحددين.','No activity in the selected period and scope.')}</p>}
   <p className="sales-visual-footnote">{t('الأرقام محسوبة من كل السجلات المسموح بها، وليست من أول صفحة في الجدول. الأيام بدون نشاط لا تظهر كنقاط.','Values use all authorized records, not only the first table page. Days without activity are omitted.')}</p>
  </section>
  <section className="sales-visual-card" aria-label={t('مقارنة أداء المندوبين','Representative performance comparison')}>
   <div className="sales-visual-heading"><div><h3>{t('أداء فريق المبيعات','Sales team activity')}</h3><p>{t('ترتيب وصفي حسب العقود، ثم طلبات الحجز، ثم المكالمات. بدون خلط مبالغ عملات مختلفة.','Descriptive order by contracts, then booking requests, then calls. No cross-currency money totals.')}</p></div><span className="sales-visual-note">{count(data.representatives_total)} {t('موظف له نشاط','active representatives')}</span></div>
   {top.length?<div className="table-scroll"><table className="sales-visual-table"><thead><tr><th>{t('الموظف','Representative')}</th><th>{t('المكالمات','Calls')}</th><th>{t('الحجوزات','Bookings')}</th><th>{t('العقود','Contracts')}</th></tr></thead><tbody>{top.map(row=><tr key={row.user_id}><td><bdi>{row.salesperson}</bdi></td><td>{count(Number(row.calls))}</td><td>{count(Number(row.bookings))}</td><td><strong>{count(Number(row.sales))}</strong></td></tr>)}</tbody></table></div>:<p className="sales-visual-empty">{t('لا يوجد نشاط مسجل للموظفين في الفترة.','No representative activity recorded in this period.')}</p>}
   <p className="sales-visual-footnote">{t('يظهر أول 10 موظفين حسب الترتيب المذكور؛ الفلاتر والصلاحيات تنطبق على الجميع. ترتيب الأنشطة ليس تقييمًا لجودة الموظف.','Shows the first 10 representatives in the specified order, scoped to the same filters and access rights. Activity order is not a quality score.')}</p>
  </section>
 </div>;
}
