'use client';
import {timeZoneLabel} from '../lib/bunyra/ui-labels';
import {currencyLabel} from '../lib/bunyra/ui-labels';
import {useEffect,useRef,useState} from 'react';
import {BarChart3,RefreshCw} from 'lucide-react';
import {LineChart,Line,CartesianGrid,XAxis,YAxis,Tooltip,Legend,ResponsiveContainer} from 'recharts';
import {majorAmount} from '../lib/bunyra/pricing-calculator';
import {reportWindow,type ReportPreset} from '../lib/bunyra/report-dates';
import {downloadReportCsv} from './report-download';

type Money={currency:string;contracts:number;contract_value_minor:string;collected_minor:string;outstanding_minor:string;excess_minor:string};
type Trend={period:string;currency:string;contracts:number;contract_value_minor:string;collected_minor:string;outstanding_minor:string};
type Project={project_id:string;project_name:string;currency:string;contracts:number;contract_value_minor:string;collected_minor:string;outstanding_minor:string};
type Data={money:Money[];trend:Trend[];projects:Project[];total_contracts:number;available_projects:{id:string;name:string}[];members:{user_id:string;email:string}[];time_zone:string;as_of:string;interpretation:string};
type Filters={project:string;user:string;from:string;to:string;group:'day'|'week'|'month'};

function collectionRatio(signed:string,collected:string){
 const value=BigInt(signed||'0');return value>BigInt(0)?Math.min(100,Math.max(0,Number((BigInt(collected||'0')*BigInt(10000))/value)/100)):0;
}
export default function DealsInsightsPanel({companyId,en=false,asOwner=false,active=true}:{companyId:string;en?:boolean;asOwner?:boolean;active?:boolean}){
 const t=(ar:string,eng:string)=>en?eng:ar;
 const initial=reportWindow('month','Africa/Cairo');
 const [filters,setFilters]=useState<Filters>({project:'',user:'',from:initial.from,to:initial.to,group:'month'});
 const [applied,setApplied]=useState<Filters>(filters);
 const [preset,setPreset]=useState<ReportPreset|null>('month');
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [currency,setCurrency]=useState('');
 const [exporting,setExporting]=useState('');
 const generation=useRef(0);
 const base='/api/deals-insights?'+new URLSearchParams({company:companyId,...(asOwner?{mode:'platform'}:{})});
 useEffect(()=>{
  if(!active)return;
  const token=++generation.current;
  setLoading(true);setError('');
  const search=new URLSearchParams({project:applied.project,user:applied.user,from:applied.from,to:applied.to,group:applied.group});
  void (async()=>{
   const r=await fetch(base+'&'+search,{cache:'no-store'}),response=await r.json();
   if(!r.ok)throw Error(response.error||'SERVICE_UNAVAILABLE');
   if(token!==generation.current)return;
   setData(response as Data);
   setCurrency(old=>response.money.some((m:Money)=>m.currency===old)?old:response.money[0]?.currency||'');
  })().catch(e=>{if(token===generation.current){setData(null);setError(e instanceof Error&&e.message==='FORBIDDEN'?t('لا تملك صلاحيات التقارير المالية في هذا النطاق.','Financial reports are not permitted for this scope.'):e instanceof Error&&e.message==='INVALID_DATE_RANGE'?t('اختر فترة صحيحة لا تتجاوز 366 يومًا.','Choose a valid range of up to 366 days.'):t('تعذر تحميل تحليل الصفقات. حاول مجددًا.','Could not load Deals Insights. Retry.'));}})
  .finally(()=>{if(token===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[companyId,asOwner,active,applied]);
 async function exportCsv(kind:'summary'|'projects'|'timeline'){
  setExporting(kind);setError('');
  try{
   const params=new URLSearchParams({company:companyId,report:'deals',detail:kind,...applied,...(asOwner?{mode:'platform'}:{})});
   await downloadReportCsv(params,'bunyra-deals-'+kind+'-'+applied.from+'-'+applied.to+'.csv');
  }catch(e){
   const code=e instanceof Error?e.message:'';
   setError(code==='EXPORT_TOO_LARGE'?t('عدد تفاصيل التقرير أكبر من حد التصدير. قلّل الفترة أو المشروع.','Report is too large. Narrow the date range or project.'):code==='FORBIDDEN'?t('لا تملك صلاحية تصدير بيانات التحصيل.','You are not allowed to export collections.'):t('تعذر تنزيل التقرير. حاول مجددًا.','Could not download the report. Please retry.'));
  }finally{setExporting('');}
 }
 function quick(p:ReportPreset){
  const window=reportWindow(p,data?.time_zone||'Africa/Cairo');
  const next={...filters,...window};
  setFilters(next);setApplied(next);setPreset(p);
 }
 const snapshot=data?.money.find(x=>x.currency===currency);
 const series=(data?.trend||[]).filter(x=>x.currency===currency).map(x=>({period:x.period,value:Number(x.contract_value_minor)/100,collected:Number(x.collected_minor)/100,outstanding:Number(x.outstanding_minor)/100}));
 const number=(x:number)=>x.toLocaleString(en?'en-GB':'ar-EG-u-nu-latn');
 return <section className="panel deals-insights">
  <div className="panel-heading"><div><div className="eyebrow">{en?'BUNYRA · DEALS INSIGHTS':'تحليل الصفقات'}</div><h2>{t('تحليل الصفقات والتحصيلات','Deals & collections insights')}</h2><p className="muted">{t('عقود الفترة المحددة، وصافي ما تم تحصيله منها حتى الآن. لا تُحتسب عروض الأسعار ولا العقود الملغاة.','Contracts signed in the selected period and their confirmed net receipts to date. Offers and cancelled contracts are excluded.')}</p></div><button className="secondary" onClick={()=>setApplied({...applied})} disabled={loading}><RefreshCw size={16}/>{t('تحديث','Refresh')}</button></div>
  <div className="reports-presets" role="group" aria-label={t('الفترات السريعة','Quick date presets')}>{([['today','اليوم','Today'],['week','هذا الأسبوع','This week'],['month','هذا الشهر','This month'],['30days','آخر 30 يوم','Last 30 days']] as const).map(([key,ar,eng])=><button key={key} type="button" className={'reports-preset'+(preset===key?' is-selected':'')} aria-pressed={preset===key} onClick={()=>quick(key)}>{t(ar,eng)}</button>)}</div>
  <form className="module-filters" onSubmit={event=>{event.preventDefault();setPreset(null);setApplied({...filters});}}>
   <label>{t('المشروع','Project')}<select value={filters.project} onChange={e=>setFilters({...filters,project:e.target.value})}><option value="">{t('كل المشروعات المسموحة','All permitted projects')}</option>{data?.available_projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label>{t('الموظف','Representative')}<select value={filters.user} onChange={e=>setFilters({...filters,user:e.target.value})}><option value="">{t('كل الموظفين المسموحين','All permitted representatives')}</option>{data?.members.map(m=><option key={m.user_id} value={m.user_id}>{m.email}</option>)}</select></label>
   <label>{t('من تاريخ توقيع','Signed from')}<input required type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></label>
   <label>{t('إلى تاريخ توقيع','Signed through')}<input required type="date" value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></label>
   <label>{t('التجميع الزمني','Group by')}<select value={filters.group} onChange={e=>setFilters({...filters,group:e.target.value as Filters['group']})}><option value="day">{t('يومي','Day')}</option><option value="week">{t('أسبوعي','Week')}</option><option value="month">{t('شهري','Month')}</option></select></label>
   <button className="primary" type="submit" disabled={loading}>{t('تطبيق الفلاتر','Apply filters')}</button>
  </form>
  <div className="report-export-actions" aria-label={t('تصدير التقارير','Export reports')}>
   {([['summary','ملخص العملات CSV','Currency summary CSV'],['projects','المشروعات CSV','Projects CSV'],['timeline','الاتجاه الزمني CSV','Timeline CSV']] as const).map(([key,ar,eng])=>
    <button key={key} className="secondary" type="button" disabled={loading||!!exporting||!data} onClick={()=>void exportCsv(key)}>{exporting===key?t('جارٍ التصدير…','Exporting…'):t(ar,eng)}</button>)}
  </div>
  {loading&&<p role="status">{t('جارٍ إعداد تحليل الصفقات…','Loading Deals Insights…')}</p>}
  {error&&<p role="alert" className="inline-error">{error}</p>}
  {data&&!loading&&<><p className="report-scope-note">{t('توقيت الشركة','Company time zone')}: <bdi>{timeZoneLabel(data.time_zone,en)}</bdi> · {t('لحظة حساب التحصيل','Collection snapshot')}: {new Date(data.as_of).toLocaleString(en?'en-GB':'ar-EG-u-nu-latn',{timeZone:data.time_zone})}</p>
   {!data.money.length?<div className="sales-visual-empty">{t('لا توجد عقود غير ملغاة بتاريخ توقيع ضمن الفترة المحددة وصلاحياتك.','No non-cancelled contracts signed within the selected dates and permissions.')}</div>:<>
   <div className="deals-currencies" role="group" aria-label={t('العملة','Currency')}>{data.money.map(m=><button key={m.currency} type="button" className={'reports-preset'+(currency===m.currency?' is-selected':'')} aria-pressed={currency===m.currency} onClick={()=>setCurrency(m.currency)}>{currencyLabel(m.currency,en)} · {number(m.contracts)} {t('عقد','contracts')}</button>)}</div>
   {snapshot&&<><div className="deals-metric-grid">
    {([['contract_value_minor','قيمة العقود','Contract value'],['collected_minor','صافي التحصيل المؤكد','Confirmed net collected'],['outstanding_minor','المتبقي من قيمة العقود','Outstanding contract value']] as const).map(([key,ar,eng])=><div className="deals-metric" key={key}><span>{t(ar,eng)}</span><strong dir="ltr">{majorAmount(snapshot[key])} <small>{currencyLabel(currency,en)}</small></strong></div>)}
   </div>
   <div className="deals-progress"><div className="deals-progress-heading"><h3>{t('نسبة التحصيل من قيمة عقود الفترة','Collections as a share of the selected contracts')}</h3><bdi>{collectionRatio(snapshot.contract_value_minor,snapshot.collected_minor).toFixed(1)}%</bdi></div><div className="deals-progress-track" role="progressbar" aria-valuenow={collectionRatio(snapshot.contract_value_minor,snapshot.collected_minor)} aria-valuemin={0} aria-valuemax={100}><div style={{width:collectionRatio(snapshot.contract_value_minor,snapshot.collected_minor)+'%'}}/></div>
   {BigInt(snapshot.excess_minor)>BigInt(0)&&<p className="muted">{t('تحصيل زائد مسجل:','Recorded excess receipts:')} <bdi>{majorAmount(snapshot.excess_minor)} {currencyLabel(currency,en)}</bdi></p>}</div></>}
   <div className="sales-visuals"><section className="sales-visual-card"><div className="sales-visual-heading"><div><h3>{t('قيمة الصفقات والتحصيل حسب تاريخ توقيع العقد','Contract cohort value & collections by signing date')}</h3><p>{t('التحصيل المعروض حتى الآن لكل مجموعة عقود، وليس المدفوعات التي تمت في نفس الشهر.','Cumulative receipts on each signing cohort, not payments received in that calendar period.')}</p></div><BarChart3 size={19}/></div>
   {series.length>0?<div role="img" aria-label={t('رسم لقيمة العقود وصافي التحصيل والمتبقي؛ القيم متاحة في الجدول.','Chart of contracts, collections and outstanding amounts; amounts also appear in the table.')}>
   <ResponsiveContainer width="100%" height={270}><LineChart data={series} margin={{top:12,right:14,bottom:5,left:4}} accessibilityLayer><CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="4 4"/><XAxis dataKey="period" tick={{fill:'var(--muted)',fontSize:11}} tickLine={false} axisLine={false} tickFormatter={(x:string)=>x.slice(5)}/><YAxis tick={{fill:'var(--muted)',fontSize:11}} width={52} tickLine={false} axisLine={false} tickFormatter={(n:number)=>Intl.NumberFormat('en',{notation:'compact'}).format(n)}/><Tooltip contentStyle={{background:'var(--surface)',color:'var(--ink)',borderColor:'var(--line)',borderRadius:12}} formatter={value=>[Number(value).toLocaleString(en?'en-GB':'ar-EG-u-nu-latn',{maximumFractionDigits:2}),currency]}/><Legend/><Line dataKey="value" name={t('العقود','Contracts')} stroke="var(--primary)" strokeWidth={2.5} dot={false}/><Line dataKey="collected" name={t('التحصيل','Collected')} stroke="var(--green)" strokeWidth={2.5} dot={false}/><Line dataKey="outstanding" name={t('المتبقي','Outstanding')} stroke="var(--ink)" strokeWidth={2.5} dot={false}/></LineChart></ResponsiveContainer></div>:<p className="sales-visual-empty">{t('لا توجد حركة ضمن هذا النطاق.','No activity for this selection.')}</p>}</section>
   <section className="sales-visual-card"><div className="sales-visual-heading"><div><h3>{t('التحصيل حسب المشروع','Collection breakdown by project')}</h3><p>{t('نفس العقود والصلاحيات، وكل عملة معروضة منفصلة.','Same contract and permission scope, one currency at a time.')}</p></div></div><div className="table-scroll"><table className="sales-visual-table"><thead><tr><th>{t('المشروع','Project')}</th><th>{t('العقود','Contracts')}</th><th>{t('قيمة العقود','Value')}</th><th>{t('صافي التحصيل','Collected')}</th><th>{t('المتبقي','Outstanding')}</th></tr></thead><tbody>{data.projects.filter(p=>p.currency===currency).map(p=><tr key={p.project_id}><td>{p.project_name}</td><td>{number(p.contracts)}</td><td><bdi>{majorAmount(p.contract_value_minor)}</bdi></td><td><bdi>{majorAmount(p.collected_minor)}</bdi></td><td><bdi>{majorAmount(p.outstanding_minor)}</bdi></td></tr>)}</tbody></table></div></section></div>
   </>}
   <p className="sales-visual-footnote">{t('القيمة المتبقية = قيمة العقد ناقص صافي التحصيل المؤكد حتى الآن (بحد أدنى صفر). المرتجعات والعكس المالي تخصم من التحصيل، والتسويات غير النقدية لا تضاف إليه.','Outstanding = contract value minus confirmed net collections to date (floor zero). Refunds/reversals reduce collections; non-cash settlements do not increase them.')}</p>
  </>}
 </section>;
}
