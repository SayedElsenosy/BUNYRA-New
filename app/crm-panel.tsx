'use client';
import {createPortal} from 'react-dom';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CheckCircle2, MessageSquareText, Phone, Plus, Search, Target, Users, X } from 'lucide-react';

import CustomerJourneyPanel from './customer-journey-panel';
import LeadWorkspace,{LeadActionDialog,type WorkspaceLead,type WorkspaceCustomer} from './lead-workspace';
import {LEAD_STAGES} from '../lib/bunyra/lead-stages';
import {useWorkspaceLocation} from './workspace-location';

type Lead = WorkspaceLead;
type Customer = WorkspaceCustomer;
type Overview = { time_zone:string; can_write:boolean; can_assign?:boolean; auto_assign_available?:boolean; auto_assign_enabled?:boolean; customers: Customer[]; stats: { customers: number; open_leads: number; overdue_follow_ups: number; won_leads: number }; projects: { id: string; name: string }[]; members: { user_id: string; email: string; role: string }[]; interactions: { id: string; customer_id: string; kind: string; body: string; created_at: string }[]; followUps: { id: string; customer_id: string; due_at: string; title: string; status: string }[] };

const statuses = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'paused'];
const statusColor: Record<string, string> = { new: 'crm-status-new', contacted: 'crm-status-contacted', qualified: 'crm-status-qualified', proposal: 'crm-status-proposal', won: 'crm-status-won', lost: 'crm-status-lost', paused: 'crm-status-paused' };

export default function CrmPanel({ companyId, en = false, asOwner = false }: { companyId: string; en?: boolean; asOwner?: boolean }) {
  const [route,navigate]=useWorkspaceLocation();
  const t = (ar: string, eng: string) => en ? eng : ar;
  const modalRef=useRef<HTMLDivElement>(null);
  const [revision,setRevision]=useState(0);
  const [data, setData] = useState<Overview | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [modal, setModal] = useState<'customer' | 'lead' | 'interaction' | 'follow_up' | null>(null);
  const [actionTarget,setActionTarget]=useState<{lead:Lead;customer:Customer}|null>(null);
  const [actionError,setActionError]=useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [customerForm, setCustomerForm] = useState({ full_name: '', phone: '', email: '', address: '', notes: '' });
  const [leadForm, setLeadForm] = useState({ source: 'website', status: 'new', stage_code:'fresh', owner_user_id: '', project_id: '', interest: '' });
  const [interactionForm, setInteractionForm] = useState({ kind: 'call', body: '' });
  const [followForm, setFollowForm] = useState({ title: '', due_at: '', assigned_to: '',repeat_kind:'none',repeat_every:1,lead_id:'' });
  const endpoint = `/api/crm?company=${encodeURIComponent(companyId)}${asOwner ? '&mode=platform' : ''}`;
  useEffect(()=>{setData(null);setSelected(null);setActionTarget(null);setModal(null);setActionError('');},[companyId,asOwner]);

  async function load(signal?:AbortSignal) {
    const r = await fetch(`${endpoint}&q=${encodeURIComponent(route.record?'':q)}&status=${encodeURIComponent(status)}${route.record?'&customer='+encodeURIComponent(route.record):''}`,{signal});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'load');
    if(signal?.aborted)return;
    if(!route.record||!data)setData(d);
    if(route.record){const customer=(d.customers as Customer[]).find(c=>c.id===route.record)||null;setSelected(customer);if(!customer)setMessage(t('السجل غير متاح لحسابك.','This record is unavailable.'));}
    if (!route.record&&selected) setSelected((d.customers as Customer[]).find(c => c.id === selected.id) || null);
  }
  useEffect(()=>{if(route.view!=='customers')return;const controller=new AbortController();void load(controller.signal).catch(()=>{if(!controller.signal.aborted)setMessage(t('تعذر تحميل CRM.','Could not load CRM.'));});return()=>controller.abort();},[companyId,status,route.record,route.view]);
  useEffect(()=>{if(route.view!=='customers')return;if(route.action==='new_customer'){openCustomer();navigate({action:''},true);}else if(route.action==='new_follow_up'&&selected?.id===route.record){setFollowForm({title:'',due_at:'',assigned_to:'',repeat_kind:'none',repeat_every:1,lead_id:selectedLeads[0]?.id||''});setModal('follow_up');navigate({action:''},true);}},[route.view,route.action,route.record,selected?.id]);

  useEffect(()=>{if(!modal)return;const previous=document.activeElement as HTMLElement|null;const box=modalRef.current;const controls=()=>Array.from(box?.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex="0"]')||[]).filter(e=>!e.hasAttribute('disabled'));controls().find(e=>e.tagName==='INPUT'||e.tagName==='TEXTAREA')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy){setModal(null);e.preventDefault();}if(e.key==='Tab'){const items=controls(),first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){last?.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first?.focus();e.preventDefault();}}};box?.addEventListener('keydown',key);return()=>{box?.removeEventListener('keydown',key);previous?.focus();};},[modal,busy]);
  const selectedLeads = useMemo(() => selected?.leads || [], [selected]);
  const labelStatus = (value: string) => ({ new: t('جديد', 'New'), contacted: t('تم التواصل', 'Contacted'), qualified: t('مؤهل', 'Qualified'), proposal: t('عرض', 'Proposal'), won: t('ناجح', 'Won'), lost: t('خاسر', 'Lost'), paused: t('متوقف', 'Paused') }[value] || value);
  const labelKind = (value: string) => ({ call: t('مكالمة', 'Call'), meeting: t('اجتماع', 'Meeting'), whatsapp: 'WhatsApp', email: 'Email', note: t('ملاحظة', 'Note') }[value] || value);

  async function submit(operation: string, body: Record<string, unknown>) {
    setBusy(true); setMessage('');
    try {
      const r = await fetch(`/api/crm${asOwner ? '?mode=platform' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, company_id: companyId, ...body }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save');
      setModal(null); await load();setRevision(n=>n+1); setMessage(t('تم الحفظ وتسجيل العملية.', 'Saved and audited.'));
    } catch (e) { setMessage(e instanceof Error && e.message === 'ALREADY_EXISTS' ? t('يوجد عميل بنفس الهاتف أو البريد.', 'A customer with this phone or email already exists.') : e instanceof Error && e.message === 'ROUTING_NO_ELIGIBLE_MEMBERS' ? t('مفيش موظف متاح لاستقبال الفرصة حسب إعدادات الفريق وصلاحيات المشروع.', 'No eligible team member for this lead and project.') : t('تعذر الحفظ. راجع البيانات وحاول مجددًا.', 'Could not save. Check the data and retry.')); }
    finally { setBusy(false); }
  }
  function openCustomer() { setCustomerForm({ full_name: '', phone: '', email: '', address: '', notes: '' }); setModal('customer'); }
  function openLead(customer: Customer) { setSelected(customer); setLeadForm({ source: 'website', status: 'new', stage_code:'fresh', owner_user_id: '', project_id: '', interest: '' }); setModal('lead'); }

  return <section className="crm-shell">{route.record&&<div className="context-banner">{t('ملف العميل المحدد','Selected customer profile')}<button onClick={()=>navigate({record:'',action:''})}>{t('كل العملاء','All customers')}</button></div>}
    <div className="page-heading"><div><div className="eyebrow">BUNYRA · CRM</div><h2>{t('العملاء والفرص', 'Customers & Leads')}</h2><p>{t('مساحة موحدة للعميل من أول تواصل حتى التحويل.', 'One customer workspace from first contact to conversion.')}</p></div>{data?.can_write&&<button className="primary" onClick={openCustomer}><Plus size={17} />{t('عميل جديد', 'New customer')}</button>}</div>
    {message && <div className="crm-message" role="status">{message}<button onClick={() => setMessage('')} aria-label={t('إغلاق', 'Close')}><X size={15} /></button></div>}
    <LeadWorkspace companyId={companyId} asOwner={asOwner} onAssigned={async()=>{await load();setRevision(n=>n+1);}} data={data} selected={route.view==='customers'&&route.record?selected:null} en={en}
      onOpen={c=>{setSelected(c);navigate({record:c.id,action:''});}}
      onBack={()=>{setSelected(null);navigate({record:'',action:''});}}
      onAction={(lead,customer)=>{setActionError('');setActionTarget({lead,customer});}}
      onLead={()=>selected&&openLead(selected)}
      onFollowUp={()=>{setFollowForm({title:'',due_at:'',assigned_to:'',repeat_kind:'none',repeat_every:1,lead_id:selectedLeads[0]?.id||''});setModal('follow_up');}}
      onInteraction={()=>{setInteractionForm({kind:'note',body:''});setModal('interaction');}}>
      {selected&&<CustomerJourneyPanel companyId={companyId} customerId={selected.id} en={en} asOwner={asOwner} revision={revision} active={route.view==='customers'} onLead={()=>openLead(selected)} onInteraction={kind=>{setInteractionForm({kind,body:''});setModal('interaction');}} onFollowUp={()=>{setFollowForm({title:'',due_at:'',assigned_to:'',repeat_kind:'none',repeat_every:1,lead_id:selectedLeads[0]?.id||''});setModal('follow_up');}} onClose={()=>{setSelected(null);navigate({record:'',action:''});}}/>}
    </LeadWorkspace>
    {actionTarget&&<LeadActionDialog key={actionTarget.lead.id} lead={actionTarget.lead} customer={actionTarget.customer} zone={data?.time_zone||'Africa/Cairo'} en={en} busy={busy} error={actionError} onClose={()=>setActionTarget(null)} onSave={async body=>{
      setBusy(true);setActionError('');
      try{const r=await fetch(`/api/crm${asOwner?'?mode=platform':''}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'lead_action',company_id:companyId,...body})});const d=await r.json();if(!r.ok)throw Error(d.error);setActionTarget(null);setRevision(n=>n+1);window.dispatchEvent(new Event('bunyra:alerts-changed'));setMessage(t('تم حفظ الإجراء والمرحلة والموعد.','Action, stage and next date saved.'));await load().catch(()=>setMessage(t('تم حفظ الإجراء، لكن تعذر تحديث العرض. حدّث الصفحة لعرضه.','Action saved, but the view could not refresh. Reload the page.')));}
      catch(e){const code=e instanceof Error?e.message:'';setActionError(code==='VERSION_CONFLICT'?t('اتغيرت الفرصة في جلسة أخرى. اقفل النافذة وحدّث الصفحة قبل إعادة المحاولة.','This lead changed elsewhere. Close and refresh before retrying.'):code==='INVALID_FOLLOW_UP_DATE'?t('اختار موعدًا قادمًا وصحيحًا بتوقيت الشركة.','Choose a valid future date in company time.'):t('تعذر حفظ الإجراء. راجع البيانات والصلاحيات.','Could not save. Check values and permissions.'));}finally{setBusy(false);}
    }}/>}
    {modal && createPortal(<div className="modal-backdrop crm-side-backdrop" role="presentation"><div className="modal crm-modal" ref={modalRef} role="dialog" aria-modal="true" aria-label={t('إجراء على ملف العميل','Customer action')}><div className="panel-heading"><div><span className="eyebrow">BUNYRA · CRM</span><h3>{modal === 'customer' ? t('إضافة عميل', 'Add customer') : modal === 'lead' ? t('إنشاء فرصة', 'Create lead') : modal === 'interaction' ? t('تسجيل تفاعل', 'Log interaction') : t('جدولة متابعة', 'Schedule follow-up')}</h3></div><button className="icon-button" onClick={() => setModal(null)} aria-label={t('إغلاق', 'Close')}><X size={17} /></button></div>{modal === 'customer' && <form onSubmit={e => { e.preventDefault(); void submit('customer', customerForm); }}><div className="form-grid"><label>{t('الاسم الكامل', 'Full name')}<input required minLength={2} value={customerForm.full_name} onChange={e => setCustomerForm({ ...customerForm, full_name: e.target.value })} /></label><label>{t('الهاتف', 'Phone')}<input required value={customerForm.phone} dir="ltr" onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })} /></label><label>{t('البريد الإلكتروني', 'Email')}<input type="email" value={customerForm.email} dir="ltr" onChange={e => setCustomerForm({ ...customerForm, email: e.target.value })} /></label><label>{t('العنوان', 'Address')}<input value={customerForm.address} onChange={e => setCustomerForm({ ...customerForm, address: e.target.value })} /></label></div><label>{t('ملاحظات', 'Notes')}<textarea value={customerForm.notes} onChange={e => setCustomerForm({ ...customerForm, notes: e.target.value })} /></label><div className="modal-actions"><button className="primary" disabled={busy}>{t('حفظ العميل', 'Save customer')}</button></div></form>}{modal === 'lead' && selected && <form onSubmit={e => { e.preventDefault(); void submit('lead', { customer_id: selected.id, ...leadForm, project_id: leadForm.project_id || null, owner_user_id: leadForm.owner_user_id || undefined }); }}><label>{t('مصدر الفرصة', 'Lead source')}<input required value={leadForm.source} onChange={e => setLeadForm({ ...leadForm, source: e.target.value })} /></label><div className="form-grid"><label>{t('الحالة', 'Status')}<select value={leadForm.stage_code} onChange={e => setLeadForm({ ...leadForm, stage_code: e.target.value })}>{LEAD_STAGES.map(s => <option key={s[0]} value={s[0]}>{s[en?2:1]}</option>)}</select></label><label>{t('المسؤول', 'Owner')}<select value={leadForm.owner_user_id} onChange={e => setLeadForm({ ...leadForm, owner_user_id: e.target.value })}><option value="">{data?.auto_assign_available && data?.auto_assign_enabled ? t('توزيع تلقائي على الفريق','Auto-assign to the team') : t('أنا','Me')}</option>{data?.members.map(m => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}</select></label><label>{t('المشروع محل الاهتمام', 'Interested project')}<select value={leadForm.project_id} onChange={e => setLeadForm({ ...leadForm, project_id: e.target.value })}><option value="">{t('غير محدد', 'Not specified')}</option>{data?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><label>{t('احتياج العميل', 'Customer interest')}<textarea value={leadForm.interest} onChange={e => setLeadForm({ ...leadForm, interest: e.target.value })} /></label><div className="modal-actions"><button className="primary" disabled={busy}>{t('حفظ الفرصة', 'Save lead')}</button></div></form>}{modal === 'interaction' && selected && <form onSubmit={e => { e.preventDefault(); void submit('interaction', { customer_id: selected.id, lead_id: null, ...interactionForm }); }}><div className="form-grid"><label>{t('نوع التفاعل', 'Interaction type')}<select value={interactionForm.kind} onChange={e => setInteractionForm({ ...interactionForm, kind: e.target.value })}><option value="call">{t('مكالمة', 'Call')}</option><option value="meeting">{t('اجتماع', 'Meeting')}</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="note">{t('ملاحظة', 'Note')}</option></select></label></div><label>{t('التفاصيل', 'Details')}<textarea required value={interactionForm.body} onChange={e => setInteractionForm({ ...interactionForm, body: e.target.value })} /></label><div className="modal-actions"><button className="primary" disabled={busy}>{t('تسجيل التفاعل', 'Log interaction')}</button></div></form>}{modal === 'follow_up' && selected && <form onSubmit={e => { e.preventDefault(); void submit('follow_up', { customer_id: selected.id, lead_id: followForm.lead_id || null, due_local:followForm.due_at,repeat_kind:followForm.repeat_kind,repeat_every:followForm.repeat_every, title: followForm.title, assigned_to: followForm.assigned_to || undefined }); }}><div className="form-grid"><label>{t('عنوان المتابعة', 'Follow-up title')}<input required minLength={2} maxLength={160} value={followForm.title} onChange={e => setFollowForm({ ...followForm, title: e.target.value })} /></label><label>{t('الموعد بتوقيت الشركة', 'Due in company time')} · {data?.time_zone}<input required type="datetime-local" value={followForm.due_at} onChange={e => setFollowForm({ ...followForm, due_at: e.target.value })} /></label></div><div className="form-grid"><label>{t('المسؤول عن المتابعة','Assigned to')}<select value={followForm.assigned_to} onChange={e=>setFollowForm({...followForm,assigned_to:e.target.value})}><option value="">{t('أنا','Me')}</option>{data?.members.map(m=><option key={m.user_id} value={m.user_id}>{m.email}</option>)}</select></label><label>{t('الفرصة المرتبطة','Related opportunity')}<select value={followForm.lead_id} onChange={e=>setFollowForm({...followForm,lead_id:e.target.value})}><option value="">{t('متابعة عامة للعميل','General customer follow-up')}</option>{selectedLeads.map(l=><option key={l.id} value={l.id}>{l.project_name||l.id.slice(0,8)} · {labelStatus(l.status)}</option>)}</select></label></div><label>{t('التكرار بعد الإكمال','Repeat after completion')}<select value={followForm.repeat_kind} onChange={e=>setFollowForm({...followForm,repeat_kind:e.target.value})}>{[['none','بدون تكرار','No repeat'],['daily','يومي','Daily'],['weekly','أسبوعي','Weekly'],['monthly','شهري','Monthly']].map(([v,ar,eng])=><option key={v} value={v}>{t(ar,eng)}</option>)}</select></label>{followForm.repeat_kind!=='none'&&<label>{t('كل عدد من الفترات','Every number of periods')}<input type="number" min={1} max={12} required value={followForm.repeat_every} onChange={e=>setFollowForm({...followForm,repeat_every:Number(e.target.value)})}/></label>}<div className="modal-actions"><button className="primary" disabled={busy}>{t('جدولة المتابعة', 'Schedule follow-up')}</button></div></form>}</div></div>,document.body)}
  </section>;
}
