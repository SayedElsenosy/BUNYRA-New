'use client';
import {currencyLabel} from '../lib/bunyra/ui-labels';
import {useEffect,useState,type FormEvent} from 'react';
import {Layers3,RefreshCw,ShieldCheck,Users,CheckCircle2} from 'lucide-react';
type Feature='crm'|'inventory'|'floorplans'|'buyer_matching'|'advanced_reports'|'commissions'|'finance_erp'|'whatsapp';
const names:{id:Feature;ar:string;en:string}[]=[
 {id:'crm',ar:'العملاء والمبيعات',en:'CRM & Sales'},
 {id:'inventory',ar:'المشروعات والوحدات',en:'Projects & inventory'},
 {id:'floorplans',ar:'المخططات التفاعلية',en:'Interactive floor plans'},
 {id:'buyer_matching',ar:'طلبات العملاء والمطابقة',en:'Buyer requests & matching'},
 {id:'advanced_reports',ar:'التقارير المتقدمة',en:'Advanced reports'},
 {id:'commissions',ar:'العمولات',en:'Commissions'},
 {id:'finance_erp',ar:'المالية والمحاسبة',en:'Finance & ERP'},
 {id:'whatsapp',ar:'تكامل واتساب',en:'WhatsApp integration'}
];
type Plan={id:string;code:string;name_ar:string;name_en:string;billing_period:'month'|'year';currency:string;price_minor:string|null;included_seats:number;included_projects:number;features:Record<string,boolean>;active:boolean;version:number};
type Subscription={company_id:string;plan_id:string;plan_code:string;status:string;seat_limit:number;project_limit:number;currency:string;billing_period:string;agreed_price_minor:string|null;starts_at:string;ends_at:string|null;version:number;used_seats:number;reserved_seats:number;used_projects:number;company_name:string};
type Company={id:string;name:string;account_limit:number;used_seats:number;reserved_seats:number;used_projects:number;version:number};
type Model={plans:Plan[];subscriptions:Subscription[];companies:Company[]};
const initial={code:'',name_ar:'',name_en:'',billing_period:'month' as 'month'|'year',currency:'EGP',price:'',included_seats:'10',included_projects:'2',active:true,features:{crm:true,inventory:true,advanced_reports:false} as Record<string,boolean>};
function minor(value:string):number|null{
 if(!value.trim())return null;
 if(!/^\d{1,13}(\.\d{1,2})?$/.test(value))throw new Error('INVALID_PRICE');
 const [whole,fraction='']=value.split('.');
 const numeric=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(numeric))throw new Error('INVALID_PRICE');
 return numeric;
}
function displayPrice(value:string|null){if(value===null)return '';const n=Number(value);return Number.isSafeInteger(n)?(n/100).toFixed(2):value;}
export default function SaaSPlansPanel({en=false}:{en?:boolean}){
 const t=(ar:string,eng:string)=>en?eng:ar;
 const [data,setData]=useState<Model|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [edit,setEdit]=useState<string|null>(null),[draft,setDraft]=useState({...initial});
 const [selectedCompany,setSelectedCompany]=useState(''),[selectedPlan,setSelectedPlan]=useState('');
 const [seats,setSeats]=useState('10'),[projects,setProjects]=useState('2'),[agreed,setAgreed]=useState('');
 const [status,setStatus]=useState<'trial'|'active'|'grace'|'suspended'>('active');
 const [endsAt,setEndsAt]=useState('');
 async function load(){
  setLoading(true);setError('');
  try{
   const res=await fetch('/api/subscriptions?scope=catalog',{cache:'no-store'});
   const payload=await res.json();
   if(!res.ok)throw Error(payload.error||'SERVICE_UNAVAILABLE');
   setData(payload);
  }catch(e){setError(e instanceof Error?e.message:'SERVICE_UNAVAILABLE');}
  finally{setLoading(false);}
 }
 useEffect(()=>{void load();},[]);
 function choosePlan(p:Plan|null){
  setEdit(p?.id||null);
  setDraft(p?{code:p.code,name_ar:p.name_ar,name_en:p.name_en,billing_period:p.billing_period,currency:p.currency,
    price:displayPrice(p.price_minor),included_seats:String(p.included_seats),included_projects:String(p.included_projects),
    active:p.active,features:{...p.features}}:{...initial,features:{...initial.features}});
 }
 function chooseCompany(companyId:string,planId=selectedPlan){
  setSelectedCompany(companyId);
  const existing=data?.subscriptions.find(s=>s.company_id===companyId);
  const plan=data?.plans.find(p=>p.id===(existing?.plan_id||planId));
  const company=data?.companies.find(c=>c.id===companyId);
  if(existing){
   setSelectedPlan(existing.plan_id);setSeats(String(existing.seat_limit));setProjects(String(existing.project_limit));
   setAgreed(displayPrice(existing.agreed_price_minor));setStatus(existing.status as typeof status);
   setEndsAt(existing.ends_at?.slice(0,16)||'');
  }else if(plan){
   setSelectedPlan(plan.id);
   setSeats(String(Math.max(plan.included_seats,(company?.used_seats||0)+(company?.reserved_seats||0))));
   setProjects(String(Math.max(plan.included_projects,company?.used_projects||0)));
   setAgreed(displayPrice(plan.price_minor));setStatus('active');setEndsAt('');
  }
 }
 function changePlan(id:string){
  setSelectedPlan(id);
  const plan=data?.plans.find(p=>p.id===id),company=data?.companies.find(c=>c.id===selectedCompany);
  if(plan&&!data?.subscriptions.some(s=>s.company_id===selectedCompany)){
   setSeats(String(Math.max(plan.included_seats,company?.used_seats||0)));
   setProjects(String(Math.max(plan.included_projects,company?.used_projects||0)));
   setAgreed(displayPrice(plan.price_minor));
  }
 }
 async function persist(path:'plan'|'assign',payload:unknown){
  setBusy(true);setError('');setMessage('');
  try{
   const res=await fetch('/api/subscriptions',{
    method:path==='plan'?'POST':'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({operation:path,data:payload})
   });
   const body=await res.json();
   if(!res.ok)throw Error(body.error||'SAVE_FAILED');
   setMessage(t('تم الحفظ بنجاح.','Saved successfully.'));
   await load();
   if(path==='plan')choosePlan(null);
  }catch(e){
   const code=e instanceof Error?e.message:'SAVE_FAILED';
   setError(code==='PROJECT_LIMIT_BELOW_USAGE'||code==='ACCOUNT_LIMIT_REACHED'||code==='LIMIT_BELOW_USAGE'?t('لا يمكن تخفيض الحد عن الاستخدام الفعلي للشركة.','Cannot set limits below current company usage.'):
     code==='VERSION_CONFLICT'?t('البيانات اتغيرت. حدّث الصفحة وجرّب تاني.','This record has changed. Refresh and retry.'):
     code==='LIMIT_BELOW_PLAN'?t('حد الاشتراك لا يمكن يقل عن العدد الموجود في الباقة.','Limits cannot be lower than the plan includes.'):
     code==='INVALID_PRICE'?t('راجع السعر. استخدم رقمًا حتى منزلتين عشريتين.','Enter a valid nonnegative price with up to two decimals.'):
     t('تعذر الحفظ. راجع المدخلات والإعدادات.','Unable to save. Check settings and inputs.'));
  }finally{setBusy(false);}
 }
 function submitPlan(e:FormEvent){
  e.preventDefault();
  const current=data?.plans.find(p=>p.id===edit);
  try{
   const payload={code:draft.code.trim(),name_ar:draft.name_ar.trim(),name_en:draft.name_en.trim(),
    billing_period:draft.billing_period,currency:draft.currency.trim().toUpperCase(),
    price_minor:minor(draft.price),included_seats:Number(draft.included_seats),included_projects:Number(draft.included_projects),
    features:Object.fromEntries(names.map(n=>[n.id,draft.features[n.id]===true])),active:draft.active,
    ...(current?{id:current.id,version:current.version}:{})};
   void persist('plan',payload);
  }catch(e){setError(t('راجع صيغة السعر.','Check the price format.'));}
 }
 function submitAssignment(e:FormEvent){
  e.preventDefault();
  const existing=data?.subscriptions.find(s=>s.company_id===selectedCompany);
  const now=new Date().toISOString(),start=existing?.starts_at||now;
  try{
   void persist('assign',{company_id:selectedCompany,plan_id:selectedPlan,seat_limit:Number(seats),
    project_limit:Number(projects),agreed_price_minor:minor(agreed),status,
    starts_at:start,ends_at:endsAt?new Date(endsAt).toISOString():null,
    version:existing?.version||0});
  }catch{setError(t('راجع السعر وموعد النهاية.','Check the price and end date.'));}
 }
 const selected=data?.companies.find(c=>c.id===selectedCompany);
 return <div className="saas-plans">
  <div className="panel-heading"><div><div className="eyebrow">{en?'BUNYRA · SUBSCRIPTIONS':'الباقات والاشتراكات'}</div><h2>{t('الباقات واشتراكات الشركات','Packages & company subscriptions')}</h2><p className="muted">{t('حدد المميزات والحدود والسعر لكل باقة، وبعدها اربط الشركات بالعقود المناسبة. لا يوجد خصم أو تحصيل تلقائي في هذه المرحلة.','Define package features, limits and prices, then assign the right company contract. No automatic payment or renewal in this phase.')}</p></div><button className="secondary" onClick={()=>void load()} disabled={loading||busy}><RefreshCw size={17}/>{t('تحديث','Refresh')}</button></div>
  {error&&<p role="alert" className="hub-error">{error}</p>}{message&&<p role="status" className="saas-success">{message}</p>}
  <section className="saas-columns">
   <div className="panel"><div className="panel-heading"><h3><Layers3 size={18}/>{t('كتالوج الباقات','Package catalog')}</h3><span className="count">{data?.plans.length||0}</span></div>
    <div className="saas-plan-list">{data?.plans.map(p=><button className="saas-plan-card" key={p.id} onClick={()=>choosePlan(p)}><strong>{en?p.name_en:p.name_ar}</strong><span>{p.code} · {currencyLabel(p.currency,en)} · {p.billing_period==='month'?t('شهري','monthly'):t('سنوي','yearly')}</span><small>{p.included_seats} {t('موظفين','seats')} · {p.included_projects} {t('مشروعات','projects')} · {displayPrice(p.price_minor)||t('سعر تعاقدي','Contract price')}</small><em>{p.active?t('متاحة','Active'):t('غير متاحة','Inactive')}</em></button>)}</div>
    {!data?.plans.length&&<p className="muted">{t('لسه مفيش باقات. أنشئ أول باقة بالحدود والمميزات اللي تناسبك.','No plans yet. Create your first package with your selected features and limits.')}</p>}
    <button type="button" className="secondary" onClick={()=>choosePlan(null)}>{t('باقة جديدة','New package')}</button>
   </div>
   <form className="panel saas-editor" onSubmit={submitPlan}><h3>{edit?t('تعديل الباقة','Edit package'):t('إنشاء باقة','Create package')}</h3>
    <div className="form-grid">
     <label>{t('كود الباقة','Code')}<input required maxLength={40} pattern="[a-z][a-z0-9_-]{2,39}" value={draft.code} onChange={e=>setDraft({...draft,code:e.target.value})} disabled={!!edit}/></label>
     <label>{t('اسم عربي','Arabic name')}<input required value={draft.name_ar} onChange={e=>setDraft({...draft,name_ar:e.target.value})}/></label>
     <label>{t('اسم إنجليزي','English name')}<input required value={draft.name_en} onChange={e=>setDraft({...draft,name_en:e.target.value})}/></label>
     <label>{t('دورة الفوترة','Billing period')}<select value={draft.billing_period} onChange={e=>setDraft({...draft,billing_period:e.target.value as 'month'|'year'})}><option value="month">{t('شهري','Monthly')}</option><option value="year">{t('سنوي','Annual')}</option></select></label>
     <label>{t('العملة','Currency')}<input value={draft.currency} maxLength={3} required onChange={e=>setDraft({...draft,currency:e.target.value})}/></label>
     <label>{t('سعر الباقة (اتركه فارغًا للتفاوض)','List price (blank = quote)')}<input inputMode="decimal" value={draft.price} onChange={e=>setDraft({...draft,price:e.target.value})}/></label>
     <label>{t('الموظفون المشمولون','Included seats')}<input type="number" min={1} max={10000} required value={draft.included_seats} onChange={e=>setDraft({...draft,included_seats:e.target.value})}/></label>
     <label>{t('المشروعات المشمولة','Included projects')}<input type="number" min={1} max={10000} required value={draft.included_projects} onChange={e=>setDraft({...draft,included_projects:e.target.value})}/></label>
    </div>
    <h4>{t('المميزات داخل الباقة','Included features')}</h4><p className="muted">{t('تنبيه: حدود الموظفين والمشروعات والتقارير المتقدمة مفعّلة تقنيًا حاليًا. باقي اختيارات المميزات تُحفظ في عقد الشركة، وهنكمل ربطها بالخدمات قبل إتاحة الباقات للبيع.','Notice: seat limits, project limits and advanced reports are technically enforced today. Other feature selections are saved as company contract metadata until their individual service gates are completed before sale.')}</p><div className="saas-feature-grid">{names.map(n=><label key={n.id}><input type="checkbox" checked={draft.features[n.id]===true} onChange={e=>setDraft({...draft,features:{...draft.features,[n.id]:e.target.checked}})}/>{t(n.ar,n.en)}</label>)}</div>
    <label><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>{t('الباقة متاحة للتعيين','Plan available for assignment')}</label>
    <button className="primary" type="submit" disabled={busy||loading}>{busy?t('جارٍ الحفظ…','Saving…'):t('حفظ الباقة','Save package')}</button>
    <p className="muted">{t('تعديل كتالوج الباقة لا يغيّر عقود الشركات المربوطة بها تلقائيًا.','Editing a catalog plan does not retroactively change company contract snapshots.')}</p>
   </form>
  </section>
  <section className="panel saas-assign"><div className="panel-heading"><h3><Users size={18}/>{t('تعيين باقة لشركة','Assign a company subscription')}</h3><span className="count">{data?.subscriptions.length||0}</span></div>
   <form onSubmit={submitAssignment}><div className="form-grid">
    <label>{t('الشركة','Company')}<select required value={selectedCompany} onChange={e=>chooseCompany(e.target.value)}><option value="">{t('اختر الشركة','Select a company')}</option>{data?.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>{t('الباقة','Plan')}<select required value={selectedPlan} onChange={e=>changePlan(e.target.value)}><option value="">{t('اختر الباقة','Select a plan')}</option>{data?.plans.filter(p=>p.active||p.id===selectedPlan).map(p=><option key={p.id} value={p.id}>{en?p.name_en:p.name_ar}</option>)}</select></label>
    <label>{t('الحد الإجمالي للموظفين','Total seat limit')}<input min={1} max={10000} type="number" required value={seats} onChange={e=>setSeats(e.target.value)}/></label>
    <label>{t('الحد الإجمالي للمشروعات','Total project limit')}<input min={1} max={10000} type="number" required value={projects} onChange={e=>setProjects(e.target.value)}/></label>
    <label>{t('السعر المتفق عليه','Agreed contract price')}<input inputMode="decimal" value={agreed} onChange={e=>setAgreed(e.target.value)} placeholder={t('اتركه فارغًا للتفاوض','Leave blank to negotiate')}/></label>
    <label>{t('حالة الاشتراك','Subscription status')}<select value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="trial">{t('تجريبي','Trial')}</option><option value="active">{t('نشط','Active')}</option><option value="grace">{t('فترة سماح','Grace')}</option><option value="suspended">{t('موقوف','Suspended')}</option></select></label>
    <label>{t('تاريخ نهاية التعاقد (اختياري)','Contract end (optional)')}<input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)}/></label>
   </div>
   {selected&&<p className="muted">{t('الاستخدام الفعلي','Current usage')}: {selected.used_seats} {t('موظف نشط','active seats')} + {selected.reserved_seats} {t('دعوات محجوزة','reserved invitations')} · {selected.used_projects} {t('مشروع','projects')} · {t('الحد الحالي للحسابات','Current account cap')}: {selected.account_limit}</p>}
   <p className="muted">{t('لا يمكن تقليل الحدود عن استخدام الشركة الحالي. لا يتم تغيير الاشتراك تلقائيًا عند انتهاء التاريخ؛ الفوترة والتجديد ستضاف في مرحلة مستقلة.','Limits cannot fall below active usage. Expiry does not auto-change status; billing and renewals will be added separately.')}</p>
   <button className="primary" disabled={busy||!selectedCompany||!selectedPlan} type="submit"><CheckCircle2 size={17}/>{t('اعتماد اشتراك الشركة','Assign company contract')}</button>
   </form>
   <div className="table-scroll"><table><thead><tr><th>{t('الشركة','Company')}</th><th>{t('الباقة','Plan')}</th><th>{t('الموظفون','Seats')}</th><th>{t('المشروعات','Projects')}</th><th>{t('الحالة','Status')}</th></tr></thead><tbody>{data?.subscriptions.map(s=><tr key={s.company_id}><td>{s.company_name}</td><td>{s.plan_code}</td><td>{s.used_seats} + {s.reserved_seats} / {s.seat_limit}</td><td>{s.used_projects} / {s.project_limit}</td><td>{s.status}</td></tr>)}</tbody></table></div>
  </section>
 </div>;
}
