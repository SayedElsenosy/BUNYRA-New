'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Plus,X} from 'lucide-react';
import CustomerJourneyPanel from './customer-journey-panel';
import LeadWorkspace,{LeadActionDialog,type WorkspaceLead,type WorkspaceCustomer,type WorkspaceData} from './lead-workspace';
import {useWorkspaceLocation} from './workspace-location';

type Customer=WorkspaceCustomer;
type Overview=WorkspaceData&{stats:{customers:number;open_leads:number;overdue_follow_ups:number;won_leads:number}};
type CustomerForm={full_name:string;phone:string;email:string;address:string;notes:string;national_id:string};
const blank=():CustomerForm=>({full_name:'',phone:'',email:'',address:'',notes:'',national_id:''});

export default function CrmPanel({companyId,en=false,asOwner=false}:{companyId:string;en?:boolean;asOwner?:boolean}){
 const [route,navigate]=useWorkspaceLocation();
 const t=(ar:string,english:string)=>en?english:ar;
 const modalRef=useRef<HTMLDivElement>(null);
 const [data,setData]=useState<Overview|null>(null);
 const [selected,setSelected]=useState<Customer|null>(null);
 const [creating,setCreating]=useState(false);
 const [form,setForm]=useState<CustomerForm>(blank);
 const [actionTarget,setActionTarget]=useState<{lead:WorkspaceLead;customer:Customer}|null>(null);
 const [actionError,setActionError]=useState('');
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);
 const endpoint='/api/crm?company='+encodeURIComponent(companyId)+(asOwner?'&mode=platform':'');
 async function load(signal?:AbortSignal){
  const record=route.record&&route.view==='customers'?route.record:'';
  const response=await fetch(endpoint+(record?'&customer='+encodeURIComponent(record):''),{signal});
  const value=await response.json();
  if(!response.ok)throw Error(value.error||'LOAD_FAILED');
  if(signal?.aborted)return;
  if(record){const found=(value.customers as Customer[]).find(c=>c.id===record)||null;setSelected(found);if(!found)setMessage(t('ملف العميل غير متاح لصلاحياتك.','Customer record is unavailable.'));}
  else{setData(value);setSelected(null);}
 }
 useEffect(()=>{setData(null);setSelected(null);setActionTarget(null);setCreating(false);},[companyId,asOwner]);
 useEffect(()=>{
  if(route.view!=='customers')return;
  const controller=new AbortController();
  void load(controller.signal).catch(()=>{if(!controller.signal.aborted)setMessage(t('تعذر تحميل العملاء.','Unable to load customers.'));});
  return()=>controller.abort();
 },[companyId,asOwner,route.view,route.record]);
 useEffect(()=>{
  if(route.view==='customers'&&route.action==='new_customer'){
   setForm(blank());setCreating(true);navigate({action:''},true);
  }
 },[route.view,route.action]);
 useEffect(()=>{
  if(!creating)return;
  const previous=document.activeElement as HTMLElement|null;
  const dialog=modalRef.current;
  dialog?.querySelector<HTMLInputElement>('input')?.focus();
  const keyboard=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy){setCreating(false);e.preventDefault();}};
  dialog?.addEventListener('keydown',keyboard);
  return()=>{dialog?.removeEventListener('keydown',keyboard);previous?.focus();};
 },[creating,busy]);
 async function createCustomer(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;
  setBusy(true);setMessage('');
  try{
   const result=await fetch('/api/crm'+(asOwner?'?mode=platform':''),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({operation:'customer',company_id:companyId,...form})
   });
   const response=await result.json();
   if(!result.ok)throw Error(response.error||'SAVE_FAILED');
   setCreating(false);setRevision(v=>v+1);
   setMessage(t('تم إضافة العميل بمرحلة جديد.','Customer created at the New stage.'));
   await load();
  }catch(error){
   const code=error instanceof Error?error.message:'';
   setMessage(code==='ALREADY_EXISTS'
    ?t('يوجد عميل مسجل بنفس رقم الهاتف أو البريد.','A customer with this phone or email already exists.')
    :t('تعذر إضافة العميل. راجع البيانات والصلاحيات.','Could not create customer. Check input and permissions.'));
  }finally{setBusy(false);}
 }
 async function saveAction(body:Record<string,unknown>){
  if(busy)return;setBusy(true);setActionError('');
  try{
   const result=await fetch('/api/crm'+(asOwner?'?mode=platform':''),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({operation:'lead_action',company_id:companyId,...body})
   });
   const value=await result.json();
   if(!result.ok)throw Error(value.error||'SAVE_FAILED');
   setActionTarget(null);setRevision(v=>v+1);
   window.dispatchEvent(new Event('bunyra:alerts-changed'));
   setMessage(t('تم حفظ الإجراء وتحديث مرحلة العميل.','Action saved and customer stage updated.'));
   try{await load();}catch{setMessage(t('تم حفظ الإجراء؛ حدّث الصفحة لإظهار التغيير.','Action saved; refresh to see the update.'));}
  }catch(error){
   const code=error instanceof Error?error.message:'';
   setActionError(code==='VERSION_CONFLICT'
    ?t('تم تعديل العميل في جلسة أخرى. حدّث السجل قبل إعادة المحاولة.','This customer changed in another session. Refresh first.')
    :code==='INVALID_FOLLOW_UP_DATE'
      ?t('حدد موعد متابعة صحيحًا في المستقبل.','Choose a valid future follow-up date.')
      :t('تعذر حفظ الإجراء. راجع الصلاحيات والبيانات.','Could not save action. Review permissions and details.'));
  }finally{setBusy(false);}
 }
 const details=route.view==='customers'&&route.record?selected:null;
 return <section className="crm-shell">
  {route.record&&<div className="context-banner">{t('ملف العميل','Customer profile')} <button onClick={()=>navigate({record:'',action:''})}>{t('كل العملاء','All customers')}</button></div>}
  <div className="page-heading"><div><div className="eyebrow">{en?'BUNYRA · CRM':'إدارة العملاء'}</div><h2>{t('العملاء','Customers')}</h2><a href={"/customers?company="+encodeURIComponent(companyId)+(asOwner?"&mode=platform":"")}>{t("قائمة العملاء الكاملة","Full customer list")}</a><p>{t('قائمة موحدة لكل عميل ومرحلته الحالية وإجراءاته ومواعيده.','One list for every customer, their stage, actions and follow-ups.')}</p></div>
   {data?.can_write&&<button className="primary" onClick={()=>{setForm(blank());setCreating(true);}}><Plus size={17}/>{t('إضافة عميل','Add customer')}</button>}
  </div>
  {message&&<div className="crm-message" role="status">{message}<button onClick={()=>setMessage('')} aria-label={t('إغلاق','Close')}><X size={15}/></button></div>}
  <LeadWorkspace companyId={companyId} asOwner={asOwner} data={data} selected={details} en={en}
   onAssigned={async()=>{await load();setRevision(v=>v+1);}}
   onOpen={customer=>navigate({record:customer.id,action:''})}
   onBack={()=>{setSelected(null);navigate({record:'',action:''});}}
   onAction={(lead,customer)=>{setActionError('');setActionTarget({lead,customer});}}>
   {details&&<CustomerJourneyPanel companyId={companyId} customerId={details.id} en={en} asOwner={asOwner} revision={revision} active={true} onClose={()=>{setSelected(null);navigate({record:'',action:''});}}/>}
  </LeadWorkspace>
  {actionTarget&&<LeadActionDialog key={actionTarget.lead.id} lead={actionTarget.lead} customer={actionTarget.customer}
   zone={data?.time_zone||'Africa/Cairo'} en={en} busy={busy} error={actionError}
   onClose={()=>setActionTarget(null)} onSave={saveAction}/>}
  {creating&&createPortal(<div className="modal-backdrop crm-side-backdrop" role="presentation">
   <div className="modal crm-modal" ref={modalRef} role="dialog" aria-modal="true" aria-label={t('إضافة عميل','Add customer')}>
    <div className="panel-heading"><div><span className="eyebrow">{en?'BUNYRA · CRM':'إدارة العملاء'}</span><h3>{t('إضافة عميل','Add customer')}</h3></div><button className="icon-button" disabled={busy} onClick={()=>setCreating(false)} aria-label={t('إغلاق','Close')}><X size={17}/></button></div>
    <form onSubmit={e=>void createCustomer(e)}>
     <div className="form-grid">
      <label>{t('الاسم بالكامل','Full name')}<input required minLength={2} value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/></label>
      <label>{t('رقم الهاتف','Phone')}<input required dir="ltr" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      <label>{t('البريد الإلكتروني','Email')}<input type="email" dir="ltr" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <label>{t('الرقم القومي','National ID')}<input dir="ltr" maxLength={30} value={form.national_id} onChange={e=>setForm({...form,national_id:e.target.value})}/></label>
      <label>{t('العنوان','Address')}<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>
     </div>
     <p className="muted">{t('سيُضاف العميل تلقائيًا بمرحلة «جديد». استخدم «إضافة إجراء» لتحديث المرحلة والمتابعة.','Customer starts at New. Use Add Action to update their stage and next follow-up.')}</p>
     <div className="modal-actions"><button className="primary" disabled={busy}>{t(busy?'جارٍ الحفظ…':'حفظ العميل',busy?'Saving…':'Save customer')}</button></div>
    </form>
   </div>
  </div>,document.body)}
 </section>;
}
