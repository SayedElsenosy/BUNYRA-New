'use client';
import {useEffect,useState} from 'react';
import {Bell,Check,RefreshCw,ArrowUpLeft,CalendarClock} from 'lucide-react';
import {useWorkspaceLocation} from './workspace-location';
type Alert={
 id:string;kind:'follow_up'|'booking_approval'|'receipt_confirmation'|'installment'|'lead_assignment';
 title:string;context:string;due_at:string|null;created_at:string;
 assignee:string;bucket:'overdue'|'today'|'tomorrow'|'waiting'|'later';
 view:string;record_id:string;is_read:boolean;signature:string;
};
type Data={items:Alert[];total:number;unread:number;overdue:number;today:number;waiting:number;filtered_total:number;page:number;page_size:number;time_zone:string;as_of:string};
const labels:Record<Alert['kind'],[string,string]>={
 lead_assignment:['ليد جديد مسند','Fresh assigned lead'],
 follow_up:['متابعة عميل','Customer follow-up'],
 booking_approval:['اعتماد حجز','Booking approval'],
 receipt_confirmation:['تأكيد تحصيل حجز','Booking receipt confirmation'],
 installment:['قسط مستحق','Installment due']
};
const stateNames:Record<string,[string,string]>={
 overdue:['متأخر','Overdue'],today:['اليوم','Today'],tomorrow:['غدًا','Tomorrow'],
 waiting:['بانتظار إجراء','Waiting'],later:['لاحقًا','Later']
};
type Filter='all'|'unread'|'overdue'|'today'|'tomorrow'|'waiting';

export default function WorkspaceAlertsPanel({companyId,en=false,asOwner=false,active=true}:{companyId:string;en?:boolean;asOwner?:boolean;active?:boolean}){
 const [,navigate]=useWorkspaceLocation();
 const t=(ar:string,eng:string)=>en?eng:ar;
 const [filter,setFilter]=useState<Filter>('all'),[page,setPage]=useState(0);
 const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{setPage(0);setFilter('all');setData(null);},[companyId]);
 useEffect(()=>{
  if(!active)return;
  const abort=new AbortController();
  setLoading(true);setError('');
  const query=new URLSearchParams({company:companyId,order:'recent',bucket:filter,page:String(page),...(asOwner?{mode:'platform'}:{})});
  void fetch('/api/alerts?'+query,{signal:abort.signal,cache:'no-store'})
   .then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||'SERVICE_UNAVAILABLE');if(!abort.signal.aborted)setData(j);})
   .catch(e=>{if(!abort.signal.aborted){setData(null);setError(e.message||'SERVICE_UNAVAILABLE');}})
   .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>abort.abort();
 },[companyId,asOwner,filter,page,active,revision]);
 useEffect(()=>{
  if(!active)return;
  const refresh=()=>setRevision(v=>v+1);
  const timer=window.setInterval(refresh,60000);
  window.addEventListener('bunyra:alerts-changed',refresh);
  return()=>{window.clearInterval(timer);window.removeEventListener('bunyra:alerts-changed',refresh);};
 },[active]);
 async function markRead(item:Alert){
  if(busy)return false;
  setBusy(item.kind+':'+item.id);setError('');
  try{
   const r=await fetch('/api/alerts'+(asOwner?'?mode=platform':''),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({company_id:companyId,kind:item.kind,id:item.id,operation:'read'})
   });
   const response=await r.json();
   if(!r.ok)throw Error(response.error||'SERVICE_UNAVAILABLE');
   setRevision(v=>v+1);
   window.dispatchEvent(new Event('bunyra:alerts-changed'));
   return true;
  }catch(e){setError(e instanceof Error?e.message:'SERVICE_UNAVAILABLE');return false;}
  finally{setBusy('');}
 }
 async function open(item:Alert){
  if(!item.is_read&&!await markRead(item))return;
  const view=['follow_up','lead_assignment'].includes(item.kind)?'customers':item.kind==='installment'?'collections':item.kind==='receipt_confirmation'?'receipts':'bookings';
  navigate({view,record:item.record_id||'',action:'',page:'',bucket:''});
 }
 async function markAllRead(){if(busy)return;setBusy('all');setError('');try{const r=await fetch('/api/alerts'+(asOwner?'?mode=platform':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company_id:companyId,operation:'read_all'})});if(!r.ok)throw Error('UNAVAILABLE');window.dispatchEvent(new Event('bunyra:alerts-changed'));}catch{setError('UNAVAILABLE');}finally{setBusy('');}}
 const choose=(value:Filter)=>{setFilter(value);setPage(0);};
 const number=(n:number)=>n.toLocaleString(en?'en-GB':'ar-EG');
 const tabs:[Filter,string,string][]=[
  ['all','كل التنبيهات','All'],['unread','غير المقروءة','Unread'],
  ['overdue','المتأخرة','Overdue'],['today','اليوم','Today'],
  ['waiting','تنتظر إجراء','Waiting'],['tomorrow','غدًا','Tomorrow']
 ];
 return <section className="panel workspace-alerts" aria-label={t('مركز التنبيهات','Alerts center')}>
  <div className="panel-heading"><div><div className="eyebrow">BUNYRA · ALERTS</div><h2><Bell size={19} aria-hidden="true"/>{t('مركز تنبيهات العمل','Work alerts center')}</h2>
   <p className="muted">{t('تنبيهات الليدز والمتابعات والمهام حسب دورك ومشروعاتك. تتحول لمقروءة لحسابك فقط، وتظهر مجددًا إذا تغير موعدها أو أولويتها.','Active work alerts scoped to your account and projects. Read status is personal and resets if an alert changes deadline or urgency.')}</p>
  </div><div className="report-export-actions"><button className="secondary" disabled={!!busy||!data?.unread} onClick={()=>void markAllRead()}><Check size={15}/>{t('قراءة الكل','Mark all read')}</button><button className="secondary" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/>{t('تحديث','Refresh')}</button></div></div>
  <div className="alerts-metrics" aria-live="polite">
   <div><span>{t('تنبيهات نشطة','Active alerts')}</span><strong>{number(data?.total||0)}</strong></div>
   <div><span>{t('غير مقروءة','Unread')}</span><strong>{number(data?.unread||0)}</strong></div>
   <div><span>{t('متأخرة','Overdue')}</span><strong>{number(data?.overdue||0)}</strong></div>
  </div>
  <div className="alerts-filters" role="group" aria-label={t('تصفية التنبيهات','Filter alerts')}>{tabs.map(([key,ar,eng])=>
   <button key={key} type="button" className={'reports-preset'+(filter===key?' is-selected':'')} aria-pressed={filter===key} onClick={()=>choose(key)}>
    {t(ar,eng)}{data&&key==='unread'?<span className="alerts-filter-count">{number(data.unread)}</span>:null}
   </button>
  )}</div>
  {error&&<p role="alert" className="hub-error">{error==='WORK_ITEM_UNAVAILABLE'?t('التنبيه لم يعد متاحًا. حدّث القائمة.','This alert is no longer available. Refresh the list.'):error==='FORBIDDEN'?t('لا تملك صلاحية عرض التنبيهات الحالية.','Your account cannot access these alerts.'):t('تعذر تحديث التنبيهات. حاول مرة أخرى.','Could not load or update alerts. Retry.')}</p>}
  {loading?<div className="loading" role="status">{t('جارٍ تحديث التنبيهات…','Loading alerts…')}</div>:data&&<>{data.items.length?<div className="alerts-list">{data.items.map(item=>
   <article key={item.kind+item.id} className={'alerts-item'+(item.is_read?' is-read':' is-unread')}>
    <span className={'hub-dot '+item.bucket} aria-hidden="true"/>
    <div className="alerts-item-content"><div className="alerts-item-top"><strong>{t(...labels[item.kind])}</strong><span className={'hub-bucket '+item.bucket}>{t(...stateNames[item.bucket])}</span></div>
     <p>{item.title||item.context}</p>{item.title&&item.context&&<small>{item.context}</small>}
     <small>{item.due_at?<><CalendarClock size={13} aria-hidden="true"/> {new Intl.DateTimeFormat(en?'en-GB':'ar-EG',{timeZone:data.time_zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(item.due_at))}</>:t('بانتظار إجراء بدون موعد محدد','Awaiting action, no due time')}</small>
    </div>
    <div className="alerts-item-actions">
     {!item.is_read&&<button className="secondary" disabled={!!busy} onClick={()=>void markRead(item)}><Check size={15}/>{busy===item.kind+':'+item.id?t('جارٍ الحفظ…','Saving…'):t('تعليم كمقروء','Mark read')}</button>}
     <button className="secondary" disabled={!!busy} onClick={()=>void open(item)}><ArrowUpLeft size={15}/>{t('فتح المهمة','Open task')}</button>
    </div>
   </article>
  )}</div>:<p className="sales-visual-empty">{t('مفيش تنبيهات مطابقة في النطاق ده.','No matching active alerts in this scope.')}</p>}
   {data.filtered_total>20&&<div className="hub-pagination"><button className="secondary" disabled={page===0} onClick={()=>setPage(p=>p-1)}>{t('السابق','Previous')}</button><span>{number(page+1)} / {number(Math.max(1,Math.ceil(data.filtered_total/20)))}</span><button className="secondary" disabled={(page+1)*20>=data.filtered_total} onClick={()=>setPage(p=>p+1)}>{t('التالي','Next')}</button></div>}
   <p className="sales-visual-footnote">{t('يظهر هنا العمل المفتوح فقط؛ التنبيه يختفي بعد إنهاء المهمة أو إلغاء الحجز، من غير حذف سجل العمليات. هذه إشعارات داخل النظام وليست رسائل بريد أو واتساب أو Push.','Only outstanding tasks appear here; handled work leaves this active view while audit records remain. These are in-app alerts, not email, WhatsApp or push delivery.')} · {data.time_zone}</p>
  </>}
 </section>;
}
