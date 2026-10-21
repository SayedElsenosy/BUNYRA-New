'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {Shuffle,ShieldCheck,UsersRound} from 'lucide-react';

type Routing={settings:{team_id:string|null;enabled:boolean;next_index:number;version:number};teams:{id:string;name:string;active:boolean;eligible:number}[]};

export default function LeadRoutingPanel({companyId,en=false,asOwner=false,active=true}:{companyId:string;en?:boolean;asOwner?:boolean;active?:boolean}){
 const t=(ar:string,eng:string)=>en?eng:ar;
 const [data,setData]=useState<Routing|null>(null);
 const [team,setTeam]=useState('');
 const [enabled,setEnabled]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [loading,setLoading]=useState(false);
 const [denied,setDenied]=useState(false);
 const endpoint='/api/lead-routing?company='+encodeURIComponent(companyId)+(asOwner?'&mode=platform':'');
 async function load(){
  const r=await fetch(endpoint,{cache:'no-store'});
  if(r.status===403){setDenied(true);return;}
  const response=await r.json();
  if(!r.ok)throw Error(response.error||'SERVICE_UNAVAILABLE');
  setData(response);
  setEnabled(response.settings.enabled);
  setTeam(response.settings.team_id||'');
 }
 useEffect(()=>{
  if(!active)return;
  let current=true;
  setError('');setDenied(false);
  void (async()=>{
   const r=await fetch(endpoint,{cache:'no-store'});
   if(!current)return;
   if(r.status===403){setDenied(true);return;}
   const response=await r.json();
   if(!current)return;
   if(!r.ok)throw Error(response.error||'SERVICE_UNAVAILABLE');
   setData(response);setTeam(response.settings.team_id||'');setEnabled(response.settings.enabled);
  })().catch(()=>{if(current)setError(t('تعذر تحميل إعدادات التوزيع.','Could not load assignment settings.'));});
  return()=>{current=false};
 },[companyId,asOwner,active]);
 async function save(event:FormEvent){
  event.preventDefault();if(!data||!team)return;
  setLoading(true);setError('');setNotice('');
  try{
   const r=await fetch('/api/lead-routing'+(asOwner?'?mode=platform':''),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({company_id:companyId,team_id:team,enabled,version:data.settings.version})
   });
   const result=await r.json();
   if(!r.ok)throw Error(result.error||'SERVICE_UNAVAILABLE');
   await load();
   setNotice(t('تم حفظ الإعدادات وتوثيق التغيير.','Routing settings saved and audited.'));
  }catch(e){
   const code=e instanceof Error?e.message:'';
   setError(code==='VERSION_CONFLICT'?t('الإعدادات اتغيرت من مستخدم آخر. حدّث الصفحة وحاول تاني.','Settings changed. Refresh and retry.'):code==='ROUTING_NO_ELIGIBLE_MEMBERS'?t('الفريق لازم يحتوي على موظف مبيعات نشط على الأقل.','Team needs at least one active sales representative.'):t('تعذر حفظ إعدادات التوزيع.','Could not save routing settings.'));
  }finally{setLoading(false);}
 }
 if(denied)return null;
 return <section className="panel" aria-label={t('التوزيع الآلي للعملاء','Automatic lead assignment')} style={{marginTop:16}}>
  <div className="panel-heading">
   <div><span className="eyebrow">BUNYRA · LEAD ROUTING</span><h3><Shuffle size={17} style={{verticalAlign:'middle',marginInlineEnd:8}}/>{t('توزيع الفرص تلقائيًا','Automatic lead distribution')}</h3>
    <p className="muted">{t('اختار فريق المبيعات وشغّل توزيع Round Robin للفرص الجديدة. الإعداد مقفول افتراضيًا.','Choose a team and opt in to round-robin distribution for new leads. Off by default.')}</p>
   </div><ShieldCheck size={20}/>
  </div>
  {error&&<p className="crm-message" role="alert">{error}</p>}
  {notice&&<p className="crm-message" role="status">{notice}</p>}
  {!data?<p className="muted">{t('جارٍ تحميل الإعدادات…','Loading settings…')}</p>:
   <form onSubmit={save} className="form-grid" style={{alignItems:'end',gap:14}}>
    <label>{t('الفريق المستهدف','Target team')}
     <select required value={team} onChange={e=>setTeam(e.target.value)}>
      <option value="">{t('اختر فريقًا','Choose a team')}</option>
      {data.teams.filter(v=>v.active).map(v=><option key={v.id} value={v.id}>{v.name} · {v.eligible} {t('موظف مبيعات','sales members')}</option>)}
     </select>
    </label>
    <label style={{display:'flex',alignItems:'center',gap:8}}>
     <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>
     <span>{t('تفعيل التوزيع التلقائي','Enable automatic assignment')}</span>
    </label>
    <button className="primary" type="submit" disabled={loading||!team||(enabled&&!data.teams.some(v=>v.id===team&&v.eligible>0))}>
     <UsersRound size={16}/>{loading?t('جارٍ الحفظ…','Saving…'):t('حفظ الإعدادات','Save settings')}
    </button>
   </form>}
  <p className="muted" style={{marginTop:12}}>{t('يُستخدم فقط عند إنشاء فرصة جديدة بدون تحديد موظف يدويًا بواسطة مسؤول الشركة. لا يعيد توزيع العملاء الحاليين، ويحترم حالة العضويات والصلاحيات على مستوى المشروع.','Only new leads created without an explicit owner by authorized admins use this setting. Existing leads stay unchanged; active membership and project access are checked.')}</p>
 </section>;
}
