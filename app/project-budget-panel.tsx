'use client';
import {useEffect,useMemo,useState,type FormEvent} from 'react';
import styles from './accounting-panel.module.css';

type Project={id:string;name:string};
type Account={id:string;entity_id:string;code:string;name:string;kind:string;active?:boolean};
type BudgetRow={project_id:string;project_name:string;expense_account_id:string;account_code:string;
 account_name:string;period_month:string;budget_minor:string;actual_minor:string;variance_minor:string;version:number|null};
type DraftRow={id:string;project_id:string;project_name:string;account_code:string;period_month:string;
 version:number;amount_minor:string;reason:string};
type ResponseData={rows:BudgetRow[];drafts:DraftRow[];totals:{budget_minor:string;actual_minor:string;variance_minor:string};note:string};
type Props={companyId:string;entityId:string;projects:Project[];accounts:Account[];
 from:string;to:string;projectId:string;en:boolean;asOwner:boolean};
const money=(value:string,en:boolean)=>{
 try{const cents=BigInt(value),negative=cents<BigInt(0),abs=negative?-cents:cents;
  return (negative?'-':'')+(abs/BigInt(100)).toLocaleString(en?'en-EG':'ar-EG-u-nu-latn')+'.'+
   (abs%BigInt(100)).toString().padStart(2,'0')+(en?' EGP':' ج.م');
 }catch{return '—';}
};
function parseMoney(value:string){
 const match=/^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(value.trim());
 if(!match)throw Error('INVALID_AMOUNT');
 const cents=BigInt(match[1])*BigInt(100)+BigInt((match[2]||'').padEnd(2,'0'));
 if(cents<=BigInt(0)||cents>BigInt('9223372036854775807'))throw Error('INVALID_AMOUNT');
 return cents.toString();
}
export default function ProjectBudgetPanel({companyId,entityId,projects,accounts,from,to,projectId,en,asOwner}:Props){
 const t=(ar:string,english:string)=>en?english:ar;
 const [data,setData]=useState<ResponseData|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const [project,setProject]=useState(''),[account,setAccount]=useState(''),[month,setMonth]=useState(to.slice(0,7)),
  [amount,setAmount]=useState(''),[reason,setReason]=useState('');
 const expenseAccounts=useMemo(()=>accounts.filter(a=>a.entity_id===entityId&&a.kind==='expense'&&a.active!==false),[accounts,entityId]);
 const params=useMemo(()=>{
  const q=new URLSearchParams({company:companyId,entity:entityId,from_month:from.slice(0,7)+'-01',to_month:to.slice(0,7)+'-01'});
  if(projectId)q.set('project',projectId);
  if(asOwner)q.set('mode','platform');
  return q.toString();
 },[companyId,entityId,from,to,projectId,asOwner]);
 useEffect(()=>{
  if(!entityId)return;
  const ctrl=new AbortController();
  setError('');
  fetch('/api/ledger/budgets?'+params,{signal:ctrl.signal,cache:'no-store'})
   .then(async r=>{const json=await r.json();if(!r.ok)throw Error(json.error||'BUDGET_LOAD_FAILED');return json as ResponseData;})
   .then(v=>{if(!ctrl.signal.aborted)setData(v);})
   .catch(e=>{if(!ctrl.signal.aborted){setData(null);setError(String(e.message||e));}});
  return ()=>ctrl.abort();
 },[entityId,params,refresh]);
 async function action(operation:'draft'|'approve',body:Record<string,unknown>){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const r=await fetch('/api/ledger/budgets'+(asOwner?'?mode=platform':''),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({operation,company_id:companyId,...body})
   });
   const answer=await r.json();
   if(!r.ok)throw Error(answer.error||'BUDGET_ACTION_FAILED');
   setNotice(operation==='draft'?t('تم حفظ مشروع الموازنة، وبانتظار الاعتماد.','Budget draft saved, awaiting approval.'):
    t('تم اعتماد الموازنة، والنسخة السابقة محفوظة.','Budget approved; prior version retained.'));
   if(operation==='draft'){setAmount('');setReason('');}
   setRefresh(x=>x+1);
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  try{void action('draft',{entity_id:entityId,project_id:projectId||project,
   expense_account_id:account,period_month:month+'-01',amount_minor:parseMoney(amount),reason});}
  catch(e){setError(e instanceof Error?e.message:String(e));}
 }
 const selectedProject=projectId||project;
 return <div className={styles.root}>
  <h3>{t('موازنة مصروفات المشاريع مقابل الفعلي','Project expense budgets vs actuals')}</h3>
  <p className={styles.muted}>{t('الموازنة لكل مشروع وحساب مصروف وشهر. الفعلي يُحتسب من القيود المُرحّلة فقط.','Monthly budgets per project and expense account, compared only with posted GL entries.')}</p>
  {error&&<div className={styles.error} role="alert">{error==='42P01'?t('ترحيل الموازنة 046 غير مُفعّل على هذه القاعدة.','Budget migration 046 is not installed on this database.'):error}</div>}
  {notice&&<div className={styles.notice} role="status">{notice}</div>}
  {data&&<div className={styles.metrics}>
   <div><strong>{money(data.totals.budget_minor,en)}</strong><span>{t('الموازنة المعتمدة','Approved budget')}</span></div>
   <div><strong>{money(data.totals.actual_minor,en)}</strong><span>{t('المصروف الفعلي','Actual project expenses')}</span></div>
   <div><strong>{money(data.totals.variance_minor,en)}</strong><span>{t('المتبقي / التجاوز بالسالب','Remaining / overrun if negative')}</span></div>
  </div>}
  <div className={styles.columns}>
   <form className={styles.card} onSubmit={submit}>
    <h3>{t('إضافة موازنة أو نسخة معدّلة','New budget or revision')}</h3>
    <div className={styles.fields}>
     <label>{t('المشروع','Project')}<select required disabled={!!projectId} value={selectedProject}
      onChange={e=>setProject(e.target.value)}><option value="">{t('اختر المشروع','Choose project')}</option>
      {projects.filter(p=>!projectId||p.id===projectId).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
     <label>{t('حساب المصروف','Expense account')}<select required value={account} onChange={e=>setAccount(e.target.value)}>
      <option value="">{t('اختر الحساب','Choose account')}</option>
      {expenseAccounts.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
     <label>{t('الشهر','Month')}<input type="month" required value={month} onChange={e=>setMonth(e.target.value)}/></label>
     <label>{t('المبلغ بالجنيه','Amount in EGP')}<input inputMode="decimal" required min="0.01"
      value={amount} onChange={e=>setAmount(e.target.value)} placeholder="250000.00"/></label>
     <label>{t('سبب / وصف الموازنة','Budget justification')}<input required minLength={5} maxLength={500}
      value={reason} onChange={e=>setReason(e.target.value)} placeholder={t('خطة مصروفات الشهر','Monthly expense plan')}/></label>
    </div>
    <button type="submit" disabled={busy||!entityId||!selectedProject||!account}>{t('حفظ مسودة','Save draft')}</button>
   </form>
   <div className={styles.card}>
    <h3>{t('موازنات في انتظار الاعتماد','Draft budgets awaiting approval')}</h3>
    {!data?.drafts.length&&<p className={styles.muted}>{t('لا توجد مسودات في المدة المختارة.','No draft budgets in this period.')}</p>}
    {data?.drafts.map(row=><div className={styles.compactRow} key={row.id}>
     <span>{row.project_name} · {row.account_code} · {row.period_month.slice(0,7)}
      <small> · v{row.version} · {money(row.amount_minor,en)}</small></span>
     <button disabled={busy} onClick={()=>void action('approve',{budget_id:row.id})}>{t('اعتماد','Approve')}</button>
    </div>)}
   </div>
  </div>
  <h3>{t('الانحراف المالي حسب المشروع والحساب والشهر','Variance by project, account and month')}</h3>
  <div className={styles.tableWrap}><table className={styles.table}>
   <thead><tr><th>{t('الشهر','Month')}</th><th>{t('المشروع','Project')}</th><th>{t('الحساب','Account')}</th>
    <th>{t('الموازنة','Budget')}</th><th>{t('الفعلي','Actual')}</th><th>{t('المتبقي','Variance')}</th></tr></thead>
   <tbody>{data?.rows.map((r,i)=><tr key={r.project_id+':'+r.expense_account_id+':'+r.period_month+':'+i}>
    <td>{r.period_month.slice(0,7)}</td><td>{r.project_name}</td><td>{r.account_code} — {r.account_name}</td>
    <td>{money(r.budget_minor,en)}</td><td>{money(r.actual_minor,en)}</td><td>{money(r.variance_minor,en)}</td>
   </tr>)}
   {!data?.rows.length&&<tr><td colSpan={6}>{t('لا توجد موازنات أو مصروفات مُرحّلة خلال هذه المدة.','No approved budgets or posted project expenses in this period.')}</td></tr>}
   </tbody>
  </table></div>
  <p className={styles.muted}>{t('المصروفات غير المخصصة لمشروع ليست ضمن المقارنة. الموازنة لا تمنع صرفًا تلقائيًا.','Unallocated expense entries are excluded; budgets do not automatically block expenditure.')}</p>
 </div>;
}
