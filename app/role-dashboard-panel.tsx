'use client';
import {useEffect,useState} from 'react';
import {ArrowUpLeft,ArrowRight,BarChart3,BellRing,BriefcaseBusiness,CalendarClock,ChartNoAxesCombined,ClipboardList,FileCheck2,HandCoins,Layers3,RefreshCw,UsersRound,Wallet} from 'lucide-react';
import {CartesianGrid,Legend,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {majorAmount} from '../lib/bunyra/pricing-calculator';
import {useWorkspaceLocation} from './workspace-location';

type Metrics={customers:number;open_leads:number;available_units:number;bookings_pending:number;receipts_pending:number;active_contracts:number;tasks:number;overdue:number;today:number;waiting:number};
type Money={currency:string;contracts:number;contract_value_minor:string;net_collected_minor:string|null;outstanding_minor:string|null;commissions_minor:string|null;earned_minor:string|null};
type Urgent={id:string;kind:string;title:string;context:string;due_at:string|null;record_id:string;view:string;bucket:string;version:number|null};
type Data={
 role:string;owner:boolean;time_zone:string;as_of:string;
 capabilities:{crm:boolean;write_crm:boolean;inventory:boolean;bookings:boolean;finance:boolean;commissions:boolean;team:boolean};
 allowed_views:string[];metrics:Metrics;money:Money[];pipeline:{status:string;total:number}[];
 team:{user_id:string;label:string;open:number;won:number;total:number}[];
 urgent:Urgent[];trend:{day:string;calls:number;bookings:number;contracts:number}[];
};
const roleNames:Record<string,[string,string]>={
 company_admin:['مدير الشركة','Company administrator'],sales:['مندوب المبيعات','Sales representative'],
 sales_manager:['مدير فريق المبيعات','Sales team manager'],sales_admin:['إدارة المبيعات','Sales administration'],
 operations:['إدارة العمليات','Operations'],finance_manager:['المدير المالي','Finance manager'],
 accountant:['قسم الحسابات','Accounting']
};
const stageNames:Record<string,[string,string]>={
 new:['جديد','New'],contacted:['تم التواصل','Contacted'],qualified:['مؤهل','Qualified'],
 proposal:['عرض سعر','Proposal'],won:['بيع ناجح','Won'],lost:['مفقود','Lost'],paused:['متوقف','Paused']
};
const kinds:Record<string,[string,string]>={
 follow_up:['متابعة عميل','Customer follow-up'],booking_approval:['اعتماد حجز','Booking approval'],
 receipt_confirmation:['تأكيد تحصيل','Booking receipt confirmation'],installment:['قسط مستحق','Installment due']
};
const buckets:Record<string,[string,string]>={overdue:['متأخر','Overdue'],today:['اليوم','Today'],tomorrow:['غدًا','Tomorrow'],waiting:['بانتظار إجراء','Waiting'],later:['لاحقًا','Later']};
const moneyField=(minor:string)=>majorAmount(minor);
export default function RoleDashboardPanel({companyId,en=false,asOwner=false,active=true}:{companyId:string;en?:boolean;asOwner?:boolean;active?:boolean}){
 const [,navigate]=useWorkspaceLocation();
 const t=(ar:string,english:string)=>en?english:ar;
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [currency,setCurrency]=useState('');
 const [clock]=useState(()=>new Date());
 useEffect(()=>{
  if(!active)return;
  const controller=new AbortController();
  setLoading(true);setError('');
  const query=new URLSearchParams({company:companyId,...(asOwner?{mode:'platform'}:{})});
  void fetch('/api/role-dashboard?'+query,{cache:'no-store',signal:controller.signal})
    .then(async r=>{const json=await r.json();if(!r.ok)throw Error(json.error||'LOAD_FAILED');return json as Data;})
    .then(json=>{if(!controller.signal.aborted){setData(json);setCurrency(old=>json.money.some(m=>m.currency===old)?old:json.money[0]?.currency||'');}})
    .catch(e=>{if(!controller.signal.aborted){setData(null);setError(e instanceof Error?e.message:'LOAD_FAILED');}})
    .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[companyId,asOwner,active,revision]);
 useEffect(()=>{
  if(!active)return;
  const refresh=()=>setRevision(v=>v+1);
  window.addEventListener('focus',refresh);
  window.addEventListener('bunyra:alerts-changed',refresh);
  return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('bunyra:alerts-changed',refresh)};
 },[active]);
 const go=(view:string,record='')=>{
  if(!data?.allowed_views.includes(view))return;
  navigate({company:companyId,view,record,action:'',bucket:'',page:''});
 };
 const can=(v:string)=>data?.allowed_views.includes(v)||false;
 const role=data?.owner?'company_admin':data?.role||'sales';
 const isSales=role==='sales'||role==='sales_manager'||role==='sales_admin';
 const isOps=role==='operations',isFinance=role==='finance_manager'||role==='accountant';
 const number=(v:number)=>Number(v||0).toLocaleString(en?'en-GB':'ar-EG');
 const headline=isSales?t('مبيعاتك تحت السيطرة','Your sales at a glance'):isOps?t('كل قرارات العمليات في مكان واحد','Your operations command center'):isFinance?t('موقف التحصيل والعقود','Collections and contracts overview'):t('نظرة شاملة على أداء الشركة','Company performance overview');
 const subtitle=isSales?t('عملاؤك ومهامك ونتائج مبيعاتك حسب صلاحياتك.','Your clients, tasks and sales results within your access.'):isOps?t('الحجوزات المنتظرة والوحدات والمهام المفتوحة.','Pending approvals, inventory and open tasks.'):isFinance?t('أرقام مالية مؤكدة بعملاتها ومن واقع العقود والتحصيلات.','Confirmed financial figures separated by currency and source records.'):t('المبيعات والعمليات والتحصيل والقرارات المنتظرة في لوحة واحدة.','Sales, operations, collections and pending decisions in one place.');
 const cards:{id:string;ar:string;en:string;value:number;view:string;Icon:typeof UsersRound}[]=[];
 if(data){
  const m=data.metrics;
  if(isOps){
   if(can('bookings'))cards.push({id:'approvals',ar:'حجوزات تنتظر الاعتماد',en:'Awaiting approval',value:m.bookings_pending,view:'bookings',Icon:FileCheck2});
   if(can('inventory'))cards.push({id:'available',ar:'وحدات متاحة',en:'Available units',value:m.available_units,view:'inventory',Icon:Layers3});
   cards.push({id:'work',ar:'مهام تحتاج إجراء',en:'Open work items',value:m.tasks,view:'work',Icon:ClipboardList});
  }else if(isFinance){
   if(can('receipts'))cards.push({id:'receipts',ar:'حجوزات تنتظر التحصيل',en:'Receipts awaiting confirmation',value:m.receipts_pending,view:'receipts',Icon:Wallet});
   if(can('contracts'))cards.push({id:'contracts',ar:'عقود غير ملغاة',en:'Non-cancelled contracts',value:m.active_contracts,view:'contracts',Icon:BriefcaseBusiness});
   cards.push({id:'work',ar:'مهام مالية مفتوحة',en:'Financial work items',value:m.tasks,view:'work',Icon:ClipboardList});
  }else{
   if(data.capabilities.crm&&can('pipeline'))cards.push({id:'leads',ar:'فرص بيع مفتوحة',en:'Open opportunities',value:m.open_leads,view:'pipeline',Icon:ChartNoAxesCombined});
   if(data.capabilities.crm&&can('customers'))cards.push({id:'customers',ar:'العملاء المسموحون',en:'Customers in scope',value:m.customers,view:'customers',Icon:UsersRound});
   if(data.capabilities.bookings&&can('bookings'))cards.push({id:'bookings',ar:'حجوزات تنتظر العمليات',en:'Pending bookings',value:m.bookings_pending,view:'bookings',Icon:FileCheck2});
   if(data.capabilities.inventory&&can('inventory')&&!isSales)cards.push({id:'inventory',ar:'الوحدات المتاحة',en:'Available units',value:m.available_units,view:'inventory',Icon:Layers3});
  }
  cards.push({id:'overdue',ar:'مهام متأخرة',en:'Overdue tasks',value:m.overdue,view:'work',Icon:CalendarClock});
 }
 const selected=data?.money.find(m=>m.currency===currency);
 const formatDay=(v:string)=>new Intl.DateTimeFormat(en?'en-GB':'ar-EG',{timeZone:data?.time_zone||'Africa/Cairo',weekday:'short',month:'short',day:'numeric'}).format(new Date(v+'T12:00:00Z'));
 const taskLink=(item:Urgent)=>item.kind==='follow_up'&&can('followups')?'followups':can(item.view)?item.view:'work';
 return <section className="role-dashboard">
  <div className="role-dashboard-hero">
   <div><span className="eyebrow">BUNYRA · {t('لوحة التحكم','DASHBOARD')}</span>
    <span className="role-dashboard-role">{data?.owner?t('مدير الشركة','Company administrator'):t(...(roleNames[role]||roleNames.company_admin))}</span>
    <h1>{headline}</h1><p>{subtitle}</p>
    {data&&<small>{t('بيانات محدثة بتاريخ','Snapshot at')} {new Intl.DateTimeFormat(en?'en-GB':'ar-EG',{timeZone:data.time_zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(data.as_of))} · <bdi>{data.time_zone}</bdi></small>}
   </div>
   <button type="button" className="role-dashboard-refresh" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={17}/>{t('تحديث اللوحة','Refresh dashboard')}</button>
  </div>
  {error&&<div className="hub-error" role="alert">{error==='FORBIDDEN'?t('مش مسموح لحسابك بعرض بيانات الشركة الحالية.','You cannot access this company.'):t('تعذر تحميل لوحة التحكم. جرب التحديث.','Could not load dashboard. Please retry.')}</div>}
  {loading?<div role="status" className="loading">{t('جارٍ تحميل مؤشرات شغلك…','Loading your work metrics…')}</div>:data&&<>
  <div className="role-dashboard-kpis">{cards.map(card=><button type="button" key={card.id} className="role-dashboard-kpi" disabled={!can(card.view)} onClick={()=>go(card.view)}><span className="role-dashboard-kpi-top"><card.Icon size={19}/><ArrowUpLeft size={14}/></span><strong>{number(card.value)}</strong><span>{t(card.ar,card.en)}</span></button>)}</div>
  <div className="role-dashboard-layout">
   <div className="role-dashboard-primary">
    <section className="role-dashboard-surface">
     <div className="role-dashboard-section-title"><div><h2><BarChart3 size={19}/>{t('حركة النشاط في آخر 7 أيام','Activity over the last 7 days')}</h2><p>{t('مكالمات مسجلة وطلبات حجز وعقود موقعة ضمن صلاحياتك.','Logged calls, booking requests and signed contracts in your permitted scope.')}</p></div>{can('reports')&&<button type="button" onClick={()=>go('reports')} className="role-dashboard-link">{t('التقارير','Reports')}<ArrowRight size={14}/></button>}</div>
     <div className="role-dashboard-chart" role="img" aria-label={t('اتجاه المكالمات والحجوزات والعقود خلال سبعة أيام، حسب صلاحيات حسابك.','Seven-day trends for calls, bookings and contracts within your permissions.')}>
      <ResponsiveContainer width="100%" height={255}>
       <LineChart data={data.trend} margin={{left:4,right:16,top:12,bottom:4}} accessibilityLayer>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 6" vertical={false}/><XAxis dataKey="day" tickFormatter={x=>String(x).slice(5)} tick={{fill:'var(--muted)',fontSize:11}} tickLine={false} axisLine={false}/>
        <YAxis allowDecimals={false} tick={{fill:'var(--muted)',fontSize:11}} tickLine={false} axisLine={false} width={29}/>
        <Tooltip contentStyle={{background:'var(--surface)',color:'var(--ink)',border:'1px solid var(--line)',borderRadius:10}} labelFormatter={x=>formatDay(String(x))}/>
        <Legend verticalAlign="bottom" wrapperStyle={{fontSize:11}}/>
        {data.capabilities.crm&&<Line name={t('مكالمات','Calls')} dataKey="calls" type="monotone" stroke="var(--primary)" strokeWidth={2.6} dot={false} />}
        {data.capabilities.bookings&&<Line name={t('حجوزات','Bookings')} dataKey="bookings" type="monotone" stroke="#36a49a" strokeWidth={2.6} dot={false}/>}
        {(data.capabilities.bookings||data.capabilities.finance)&&<Line name={t('عقود','Contracts')} dataKey="contracts" type="monotone" stroke="#b78d4d" strokeWidth={2.6} dot={false}/>}
       </LineChart>
      </ResponsiveContainer>
     </div>
     <p className="role-dashboard-caption">{t('كل نقطة مبنية على سجل حقيقي، بدون احتساب عروض الأسعار كمبيعات. أيام عدم النشاط قيمتها صفر.','Every point comes from recorded activity; offers are never counted as sales. Inactive days show zero.')}</p>
    </section>
    {data.capabilities.crm&&data.pipeline.length>0&&<section className="role-dashboard-surface">
     <div className="role-dashboard-section-title"><div><h2><Layers3 size={19}/>{t('توزيع الفرص حسب المرحلة','Opportunities by status')}</h2><p>{t('كل فرص البيع المسموح لك برؤيتها.','All opportunities you are authorized to see.')}</p></div>{can('pipeline')&&<button className="role-dashboard-link" onClick={()=>go('pipeline')}>{t('مسار البيع','Pipeline')}<ArrowRight size={14}/></button>}</div>
     <div className="role-dashboard-stages">{data.pipeline.map(x=><div key={x.status}><div><span>{t(...(stageNames[x.status]||[x.status,x.status]))}</span><strong>{number(x.total)}</strong></div><div className="role-dashboard-track"><span style={{width:`${Math.max(0,Math.min(100,(x.total/Math.max(1,...data.pipeline.map(p=>p.total)))*100))}%`}}/></div></div>)}</div>
    </section>}
    {data.capabilities.team&&data.capabilities.crm&&data.team.length>0&&<section className="role-dashboard-surface">
     <div className="role-dashboard-section-title"><div><h2><UsersRound size={19}/>{t('نشاط فريق المبيعات','Sales team activity')}</h2><p>{t('أفراد فريقك فقط، وعدد الفرص المسجلة لكل منهم.','Only people in your authorized scope and their opportunity counts.')}</p></div>{can('sales-teams')&&<button className="role-dashboard-link" onClick={()=>go('sales-teams')}>{t('الفرق','Teams')}<ArrowRight size={14}/></button>}</div>
     <div className="table-scroll"><table className="sales-visual-table role-dashboard-table"><thead><tr><th>{t('الموظف','Representative')}</th><th>{t('المفتوحة','Open')}</th><th>{t('مكتملة بنجاح','Won')}</th></tr></thead><tbody>{data.team.map(x=><tr key={x.user_id}><td><bdi>{x.label}</bdi></td><td>{number(x.open)}</td><td>{number(x.won)}</td></tr>)}</tbody></table></div>
    </section>}
   </div>
   <div className="role-dashboard-secondary">
    {data.money.length>0&&<section className="role-dashboard-surface">
     <div className="role-dashboard-section-title"><h2><HandCoins size={19}/>{data.capabilities.finance?t('العقود والتحصيل','Contracts & collections'):t('قيمة العقود والعمولات','Contract value & commissions')}</h2></div>
     <div className="role-dashboard-currency" role="group" aria-label={t('اختيار العملة','Select currency')}>{data.money.map(m=><button type="button" className={currency===m.currency?'selected':''} key={m.currency} aria-pressed={currency===m.currency} onClick={()=>setCurrency(m.currency)}>{m.currency}</button>)}</div>
     {selected&&<div className="role-dashboard-money">
      <div><span>{t('قيمة العقود','Contract value')}</span><strong dir="ltr">{moneyField(selected.contract_value_minor)} <small>{selected.currency}</small></strong></div>
      {data.capabilities.finance&&selected.net_collected_minor!==null&&<><div><span>{t('صافي التحصيل المؤكد','Confirmed net receipts')}</span><strong dir="ltr">{moneyField(selected.net_collected_minor)} <small>{selected.currency}</small></strong></div><div><span>{t('المتبقي من العقود','Contract value outstanding')}</span><strong dir="ltr">{moneyField(selected.outstanding_minor||'0')} <small>{selected.currency}</small></strong></div></>}
      {data.capabilities.commissions&&selected.commissions_minor!==null&&<><div><span>{t('العمولات المحسوبة','Calculated commissions')}</span><strong dir="ltr">{moneyField(selected.commissions_minor)} <small>{selected.currency}</small></strong></div><div><span>{t('العمولات المستحقة','Earned commissions')}</span><strong dir="ltr">{moneyField(selected.earned_minor||'0')} <small>{selected.currency}</small></strong></div></>}
     </div>}
     {data.capabilities.finance&&can('deals-insights')&&<button type="button" className="role-dashboard-link" onClick={()=>go('deals-insights')}>{t('تحليل الصفقات الكامل','Full Deals Insights')}<ArrowRight size={15}/></button>}
     {!data.capabilities.finance&&can('commissions')&&<button type="button" className="role-dashboard-link" onClick={()=>go('commissions')}>{t('تفاصيل العمولات','Commission details')}<ArrowRight size={15}/></button>}
     <p className="role-dashboard-caption">{t('العقود غير الملغاة فقط، والقيم مفصولة حسب العملة. التحصيلات لا تظهر بدون صلاحية مالية.','Non-cancelled contracts only, split by currency. Collections stay hidden without financial access.')}</p>
    </section>}
    <section className="role-dashboard-surface">
     <div className="role-dashboard-section-title"><div><h2><BellRing size={19}/>{t('يحتاج إجراء الآن','Needs your attention')}</h2><p>{number(data.metrics.tasks)} {t('مهمة مفتوحة','open work items')}</p></div>{can('alerts')&&<button type="button" className="role-dashboard-link" onClick={()=>go('alerts')}>{t('التنبيهات','Alerts')}<ArrowRight size={14}/></button>}</div>
     {data.urgent.length===0?<div className="role-dashboard-empty">{t('مفيش مهام عاجلة حاليًا.','No outstanding tasks in your scope.')}</div>:<div className="role-dashboard-work">{data.urgent.map(item=><button type="button" key={item.kind+item.id} className="role-dashboard-task" disabled={!can(taskLink(item))} onClick={()=>go(taskLink(item),item.kind==='follow_up'?item.id:item.record_id)}><span className={'hub-dot '+item.bucket}/><span><b>{t(...(kinds[item.kind]||[item.kind,item.kind]))}</b><small>{item.title||item.context}</small><em>{t(...(buckets[item.bucket]||buckets.later))}</em></span><ArrowUpLeft size={15}/></button>)}</div>}
     {can('work')&&<button type="button" className="role-dashboard-all-tasks" onClick={()=>go('work')}>{t('فتح كل المهام','Open all tasks')}<ArrowRight size={16}/></button>}
    </section>
    <section className="role-dashboard-surface">
     <div className="role-dashboard-section-title"><h2><BriefcaseBusiness size={19}/>{t('إجراءات سريعة','Quick actions')}</h2></div>
     <div className="role-dashboard-quick">
      {data.capabilities.write_crm&&can('customers')&&<button onClick={()=>{navigate({company:companyId,view:'customers',record:'',action:'new_customer',page:''})}}>{t('إضافة عميل','New customer')}<ArrowUpLeft size={15}/></button>}
      {data.capabilities.crm&&can('followups')&&<button onClick={()=>go('followups')}>{t('إدارة المتابعات','Manage follow-ups')}<ArrowUpLeft size={15}/></button>}
      {isOps&&can('bookings')&&<button onClick={()=>go('bookings')}>{t('طلبات اعتماد الحجز','Booking approvals')}<ArrowUpLeft size={15}/></button>}
      {data.capabilities.finance&&can('collections')&&<button onClick={()=>go('collections')}>{t('التحصيلات','Collections')}<ArrowUpLeft size={15}/></button>}
      {can('search')&&<button onClick={()=>go('search')}>{t('البحث الموحد','Global search')}<ArrowUpLeft size={15}/></button>}
     </div>
    </section>
   </div>
  </div></>}
 </section>;
}
