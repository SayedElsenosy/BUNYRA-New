import {identity,failure} from '../../../lib/bunyra/http';
import {crmInsights} from '../../../lib/bunyra/crm-insights';
import {salesReports} from '../../../lib/bunyra/sales-reports';
import {renderCrmReportPdf} from '../../../lib/bunyra/crm-report-pdf';
import {ServiceError} from '../../../lib/bunyra/service';
import {majorAmount} from '../../../lib/bunyra/pricing-calculator';
import {stageLabel} from '../../../lib/bunyra/lead-stages';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {sql,actor}=await identity();const u=new URL(request.url),company=u.searchParams.get('company')||'',platform=u.searchParams.get('mode')==='platform',kind=u.searchParams.get('report'),en=u.searchParams.get('language')==='en';
 const t=(a:string,e:string)=>en?e:a;
 if(!['leads','pipeline','team'].includes(kind||''))throw new ServiceError('INVALID_EXPORT_KIND');
 const filters=Object.fromEntries([...u.searchParams].filter(([k])=>!['company','mode','report','language'].includes(k)));
 let sections:Parameters<typeof renderCrmReportPdf>[0]['sections'];let zone:string;
 if(kind==='team'){
  const d=await salesReports(sql,actor,company,filters,platform,true) as unknown as {time_zone:string;rows:{period:string;salesperson:string;calls:number;bookings:number;sales:number;contract_value_minor:string;currency:string}[]};zone=d.time_zone;
  if(d.rows.length>1000)throw new ServiceError('PDF_TOO_LARGE',413);
  sections=[{title:t('أداء الفريق حسب الفترة والعملة','Team activity by period and currency'),headers:[t('الفترة','Period'),t('الموظف','Representative'),t('مكالمات / حجوزات / عقود','Calls / bookings / contracts'),t('قيمة العقود','Contract value')],rows:d.rows.map((r:{period:string;salesperson:string;calls:number;bookings:number;sales:number;contract_value_minor:string;currency:string})=>[r.period,r.salesperson,`${r.calls} / ${r.bookings} / ${r.sales}`,r.currency==='—'?'—':majorAmount(r.contract_value_minor)+' '+r.currency])}];
 }else{
  const {group,booking_status,contract_status,...cohort}=filters;void group;void booking_status;void contract_status;
  const d=await crmInsights(sql,actor,company,cohort,platform);zone=d.time_zone;
  if(!d.can_read_crm)throw new ServiceError('FORBIDDEN',403);
  sections=kind==='leads'?[{title:t('مصادر الليدز والتحويل','Lead sources and conversion'),headers:[t('المصدر','Source'),t('ليدز','Leads'),t('مرتبطة بعقد','Converted')],rows:d.sources.map((s:{source:string;leads:number;converted:number})=>[s.source,String(s.leads),String(s.converted)])},{title:t('التحويل الشهري','Monthly conversion'),headers:[t('الشهر','Month'),t('ليدز / متعاقدة','Leads / converted')],rows:d.months.map((m:{month:string;leads:number;converted:number})=>[m.month,`${m.leads} / ${m.converted}`])}]:[{title:t('المراحل والوقت','Stages and duration'),headers:[t('المرحلة','Stage'),t('الليدز','Leads'),t('متوسط الأيام','Average days'),t('سجلات موثقة','Tracked records')],rows:d.stages.map((s:{stage_code:string;total:number;average_days:string|null;tracked:number})=>[stageLabel(s.stage_code,en),String(s.total),s.average_days??'—',`${s.tracked}/${s.total}`])}];
 }
 const name=(await sql`SELECT name,name_en FROM companies WHERE id=${company}`)[0];
 const title=kind==='leads'?t('تقرير الليدز','Lead report'):kind==='pipeline'?t('تقرير المراحل','Pipeline report'):t('تقرير الفريق','Team report');
 const bytes=renderCrmReportPdf({title,company:en?(name?.name_en||name?.name):name?.name,period:`${filters.from} — ${filters.to}`,en,sections,notes:[t('توقيت الشركة: ','Company time zone: ')+zone,t('البيانات ضمن صلاحيات الحساب والفلاتر المختارة.','Data follows account permissions and selected filters.'),kind==='team'?t('العقود حسب تاريخ التوقيع، والملغاة مستبعدة من المبيعات.','Contracts use signing date; cancelled contracts are excluded from sales.'):t('ليدز الفترة، وحالتها الحالية. التحويل يتطلب عقدًا مرتبطًا غير ملغى حتى نهاية الفترة.','Leads created in the period and their current stage. Conversion requires a linked non-cancelled contract signed by period end.')]});
 return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="bunyra-${kind}-report.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){return failure(e);}}
