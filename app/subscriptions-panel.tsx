'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {Building2,CheckCircle,Layers3,RefreshCw,ShieldCheck,Users} from 'lucide-react';
type Features=Record<string,boolean>;
type Plan={id:string;code:string;name_ar:string;name_en:string;active:boolean;currency:string;monthly_base_minor:string;annual_base_minor:string;included_seats:number;monthly_extra_seat_minor:string;annual_extra_seat_minor:string;max_projects:number|null;max_units:number|null;features:Features;version:number};
type Assigned={company_id:string;plan_id:string;plan_code:string;company_name:string;status:string;cycle:'monthly'|'annual';extra_seats:number;included_seats:number;currency:string;base_price_minor:string;extra_seat_price_minor:string;version:number};
type Company={id:string;name:string;account_limit:number;active_seats:number;reserved_seats:number};
type Data={plans:Plan[];subscriptions:Assigned[];companies:Company[]};
const keys=[['deals_insights','تحليل العقود والتحصيل','Deals Insights'],['report_exports','تصدير التقارير','Report exports'],['interactive_plans','المخططات التفاعلية','Interactive plans'],['buyer_matching','مطابقة طلبات العملاء','Buyer matching'],['commission_reports','تقارير العمولات','Commission reports'],['finance_erp','وحدات المحاسبة المتقدمة','Advanced accounting']] as const;
const initial={code:'',name_ar:'',name_en:'',active:true,currency:'EGP',monthly_base_minor:0,annual_base_minor:0,included_seats:5,monthly_extra_seat_minor:0,annual_extra_seat_minor:0,max_projects:null as number|null,max_units:null as number|null,features:Object.fromEntries(keys.map(k=>[k[0],false])) as Features};
type PlanDraft=typeof initial&{id?:string;version?:number};
const currency=(minor:string|number,code:string)=>((Number(minor)||0)/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+code;
const minor=(value:string)=>{if(!/^\d+(\.\d{1,2})?$/.test(value.trim()))throw Error('INVALID_PRICE');const [whole,frac='']=value.trim().split('.');const n=Number(whole)*100+Number((frac+'00').slice(0,2));if(!Number.isSafeInteger(n))throw Error('INVALID_PRICE');return n;};
export default function SubscriptionsPanel({en=false}:{en?:boolean}){
 const t=(a:string,e:string)=>en?e:a;
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [draft,setDraft]=useState<PlanDraft>(initial),[edit,setEdit]=useState(false);
 const [target,setTarget]=useState(''),[planId,setPlanId]=useState(''),[cycle,setCycle]=useState<'monthly'|'annual'>('monthly'),[extra,setExtra]=useState(0);
 const [status,setStatus]=useState<'active'|'grace'|'billing_suspended'|'cancelled'>('active'),[renewal,setRenewal]=useState(''),[grace,setGrace]=useState('');
 async function load(){
  setError('');try{const r=await fetch('/api/saas-plans',{cache:'no-store'});const j=await r.json();if(!r.ok)throw Error(j.error||'LOAD_FAILED');setData(j);setTarget(old=>old||j.companies[0]?.id||'');setPlanId(old=>old||j.plans.find((p:Plan)=>p.active)?.id||'');}
  catch(e){setError(e instanceof Error?e.message:'LOAD_FAILED');}
 }
 useEffect(()=>{void load()},[]);
 function startEdit(p:Plan){setEdit(true);setDraft({...p,monthly_base_minor:Number(p.monthly_base_minor),annual_base_minor:Number(p.annual_base_minor),monthly_extra_seat_minor:Number(p.monthly_extra_seat_minor),annual_extra_seat_minor:Number(p.annual_extra_seat_minor)});}
 const set=(key:keyof PlanDraft,value:unknown)=>setDraft(old=>({...old,[key]:value}));
 async function submit(operation:'save_plan'|'assign_plan',body:unknown){
  setBusy(true);setNotice('');setError('');
  try{
   const r=await fetch('/api/saas-plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,data:body})});
   const out=await r.json();if(!r.ok)throw Error(out.error||'SAVE_FAILED');
   setNotice(t('تم الحفظ في قاعدة البيانات بنجاح.','Saved successfully to the database.'));
   await load();
  }catch(e){
   const code=e instanceof Error?e.message:'SAVE_FAILED';
   setError(({SUBSCRIPTION_SEATS_BELOW_USAGE:t('عدد المقاعد أقل من المستخدمين والدعوات الحالية.','Too few seats for active users and reservations.'),SUBSCRIPTION_PROJECTS_BELOW_USAGE:t('حد المشروعات أقل من الاستخدام الحالي.','Project limit below current usage.'),SUBSCRIPTION_UNITS_BELOW_USAGE:t('حد الوحدات أقل من الاستخدام الحالي.','Unit limit below current usage.'),VERSION_CONFLICT:t('بيانات الاشتراك اتغيرت؛ حدّث الصفحة.','Subscription changed; refresh.')}) as Record<string,string>)[code]||code);
  }finally{setBusy(false);}
 }
 function assignCompany(id:string){
  const c=data?.subscriptions.find(s=>s.company_id===id);
  setTarget(id);setPlanId(c?.plan_id||data?.plans.find(p=>p.active)?.id||'');setCycle(c?.cycle||'monthly');setExtra(c?.extra_seats||0);
  setStatus((c?.status as typeof status)||'active');setRenewal('');setGrace('');
 }
 const subscription=data?.subscriptions.find(s=>s.company_id===target);
 const selectedPlan=data?.plans.find(p=>p.id===planId);
 const limits=[['max_projects','المشروعات','Projects'],['max_units','الوحدات','Units']] as const;
 return <div className="saas-panel">
  <div className="saas-heading"><div><h2>{t('الباقات والاشتراكات','Subscription plans')}</h2><p>{t('عرّف الباقات وحدودها أولًا، وبعدها اربط الشركة بباقة. الشركات القديمة تفضل بحدودها الحالية لحين ربطها.','Create configurable plans, then assign them to companies. Legacy companies retain existing limits until assigned.')}</p></div><button type="button" className="secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/>{t('تحديث','Refresh')}</button></div>
  {error&&<div role="alert" className="hub-error">{error}</div>}
  {notice&&<p role="status" className="context-banner"><CheckCircle size={17}/>{notice}</p>}
  <div className="saas-grid">
   <section className="panel saas-card">
    <h3><Layers3 size={18}/>{edit?t('تعديل باقة','Edit plan'):t('إنشاء باقة جديدة','Create plan')}</h3>
    <form onSubmit={e=>{e.preventDefault();void submit('save_plan',draft);}} className="saas-form">
     <label>{t('رمز الباقة (لاتيني)','Plan code')}<input required disabled={edit} value={draft.code} placeholder="starter" pattern="[a-z][a-z0-9_-]{2,39}" onChange={e=>set('code',e.target.value)}/></label>
     <label>{t('اسم الباقة بالعربي','Arabic name')}<input required value={draft.name_ar} onChange={e=>set('name_ar',e.target.value)}/></label>
     <label>{t('اسم الباقة بالإنجليزي','English name')}<input required value={draft.name_en} onChange={e=>set('name_en',e.target.value)}/></label>
     <div className="saas-split"><label>{t('عملة الاشتراك','Billing currency')}<input required maxLength={3} value={draft.currency} onChange={e=>set('currency',e.target.value.toUpperCase())}/></label>
      <label>{t('المقاعد الأساسية','Included seats')}<input type="number" required min={1} max={10000} value={draft.included_seats} onChange={e=>set('included_seats',Number(e.target.value))}/></label></div>
     {([['monthly_base_minor','السعر الأساسي الشهري','Monthly base price'],['annual_base_minor','السعر الأساسي السنوي','Annual base price'],['monthly_extra_seat_minor','المقعد الإضافي شهريًا','Monthly extra seat'],['annual_extra_seat_minor','المقعد الإضافي سنويًا','Annual extra seat']] as const).map(([key,ar,eng])=><label key={key}>{t(ar,eng)} ({draft.currency})<input dir="ltr" inputMode="decimal" required defaultValue={(Number(draft[key])/100).toFixed(2)} key={draft.id+'-'+key} onChange={e=>{try{set(key,minor(e.target.value));}catch{set(key,-1);}}}/></label>)}
     <div className="saas-split">{limits.map(([key,ar,eng])=><label key={key}>{t('أقصى عدد '+ar,'Max '+eng)}<input type="number" min={1} placeholder={t('بلا حد','Unlimited')} value={draft[key]??''} onChange={e=>set(key,e.target.value===''?null:Number(e.target.value))}/></label>)}</div>
     <div className="saas-feature-list"><strong>{t('مميزات الباقة','Plan features')}</strong>{keys.map(([key,ar,eng])=><label key={key}><input type="checkbox" checked={draft.features[key]===true} onChange={e=>set('features',{...draft.features,[key]:e.target.checked})}/>{t(ar,eng)}</label>)}</div>
     <label className="saas-check"><input type="checkbox" checked={draft.active} onChange={e=>set('active',e.target.checked)}/>{t('الباقة متاحة للاشتراكات الجديدة','Available for new subscriptions')}</label>
     <div className="saas-actions"><button className="primary" disabled={busy}>{t('حفظ الباقة','Save plan')}</button>{edit&&<button className="secondary" type="button" onClick={()=>{setDraft(initial);setEdit(false);}}>{t('باقة جديدة','New plan')}</button>}</div>
    </form>
   </section>
   <div className="saas-column">
    <section className="panel saas-card"><h3><Building2 size={18}/>{t('تحديد اشتراك شركة','Assign company plan')}</h3>
     <form className="saas-form" onSubmit={e=>{e.preventDefault();if(!target||!planId)return;
      const payload={company_id:target,plan_id:planId,cycle,extra_seats:extra,status,renews_at:renewal?new Date(renewal+'T12:00:00Z').toISOString():null,grace_until:grace?new Date(grace+'T12:00:00Z').toISOString():null,...(subscription?{version:subscription.version}:{})};
      void submit('assign_plan',payload);
     }}>
      <label>{t('الشركة','Company')}<select required value={target} onChange={e=>assignCompany(e.target.value)}>{(data?.companies||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>{t('الباقة','Plan')}<select required value={planId} onChange={e=>setPlanId(e.target.value)}>{data?.plans.filter(p=>p.active||p.id===subscription?.plan_id).map(p=><option key={p.id} value={p.id}>{en?p.name_en:p.name_ar} ({p.code})</option>)}</select></label>
      <div className="saas-split"><label>{t('دورة الاشتراك','Billing cycle')}<select value={cycle} onChange={e=>setCycle(e.target.value as typeof cycle)}><option value="monthly">{t('شهري','Monthly')}</option><option value="annual">{t('سنوي','Annual')}</option></select></label><label>{t('مقاعد إضافية','Extra seats')}<input type="number" min={0} max={9999} required value={extra} onChange={e=>setExtra(Number(e.target.value))}/></label></div>
      <label>{t('حالة الاشتراك','Subscription status')}<select value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="active">{t('نشط','Active')}</option><option value="grace">{t('مهلة سداد','Grace period')}</option><option value="billing_suspended">{t('موقوف ماليًا','Billing suspended')}</option><option value="cancelled">{t('ملغي','Cancelled')}</option></select></label>
      <div className="saas-split"><label>{t('موعد التجديد (اختياري)','Renewal date (optional)')}<input type="date" value={renewal} onChange={e=>setRenewal(e.target.value)}/></label><label>{t('نهاية المهلة (عند الحاجة)','Grace deadline')}<input type="date" value={grace} onChange={e=>setGrace(e.target.value)}/></label></div>
      {selectedPlan&&<div className="saas-preview">
       <strong>{t('ملخص قبل الحفظ','Subscription preview')}</strong><p><Users size={15}/>{selectedPlan.included_seats+extra} {t('مقعد','seats')}</p>
       <p>{currency(cycle==='monthly'?selectedPlan.monthly_base_minor:selectedPlan.annual_base_minor,selectedPlan.currency)} + {extra} × {currency(cycle==='monthly'?selectedPlan.monthly_extra_seat_minor:selectedPlan.annual_extra_seat_minor,selectedPlan.currency)}</p>
       <small>{t('السعر الأساسي + المقاعد الإضافية. لا يتم تحصيل أي مدفوعات تلقائيًا من هنا.','Base price plus extra seats. No automatic payment is collected here.')}</small>
      </div>}
      <button className="primary" disabled={busy||!planId||!target}>{subscription?t('تحديث الاشتراك','Update subscription'):t('تفعيل الباقة للشركة','Assign subscription')}</button>
     </form>
    </section>
    <section className="panel saas-card"><h3><ShieldCheck size={18}/>{t('الشركات وحدود المقاعد','Company seat usage')}</h3>
     <div className="table-scroll"><table className="saas-table"><thead><tr><th>{t('الشركة','Company')}</th><th>{t('الباقة','Plan')}</th><th>{t('المقاعد','Seats')}</th></tr></thead><tbody>{data?.companies.map(c=>{const s=data.subscriptions.find(x=>x.company_id===c.id);return <tr key={c.id}><td><button className="text-link" onClick={()=>assignCompany(c.id)}>{c.name}</button></td><td>{s?.plan_code||t('بلا باقة (قديم)','Legacy')}</td><td>{c.active_seats+c.reserved_seats}/{c.account_limit}</td></tr>})}</tbody></table></div>
    </section>
    <section className="panel saas-card"><h3>{t('الباقات المعرفة','Configured plans')}</h3>
     {!data?.plans.length?<p className="muted">{t('لم يتم إنشاء باقات بعد. الأسعار والحدود تحت سيطرتك.','No plans yet. You control prices and limits.')}</p>:data.plans.map(p=><div className="saas-plan-row" key={p.id}><div><strong>{en?p.name_en:p.name_ar}</strong><small><bdi>{p.code}</bdi> · {p.included_seats} {t('مقعد أساسي','included seats')} · {currency(p.monthly_base_minor,p.currency)} / {t('شهر','month')}{!p.active?' · '+t('غير نشطة','Inactive'):''}</small></div><button className="secondary" onClick={()=>startEdit(p)}>{t('تعديل','Edit')}</button></div>)}
    </section>
   </div>
  </div>
 </div>;
}
