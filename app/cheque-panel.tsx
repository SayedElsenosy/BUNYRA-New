'use client';
import {useCallback,useEffect,useState} from 'react';
type Due={id:string;contract_id:string;contract_number:string;customer_name:string;amount_minor:string;paid_minor:string;currency_code:string};
type Account={id:string;name:string;currency_code:string};
type Cheque={id:string;contract_id:string;installment_id:string;contract_number:string;customer_name:string;amount_minor:string;currency_code:string;reference_number:string;cheque_state:'PENDING'|'CLEARED'|'BOUNCED';created_at:string};
const formatMinor=(value:string)=>{const n=BigInt(value),abs=n<BigInt(0)?-n:n;return (n<BigInt(0)?'-':'')+(abs/BigInt(100)).toString()+'.'+(abs%BigInt(100)).toString().padStart(2,'0')};
export default function ChequePanel({companyId,en,asOwner,due,accounts,canFinance}:{
 companyId:string;en:boolean;asOwner:boolean;due:Due[];accounts:Account[];canFinance:boolean;
}){
 const tr=(ar:string,english:string)=>en?english:ar;
 const [cheques,setCheques]=useState<Cheque[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [dueId,setDueId]=useState(''),[amount,setAmount]=useState(''),[reference,setReference]=useState('');
 const [selectedAccount,setSelectedAccount]=useState<Record<string,string>>({}),[rates,setRates]=useState<Record<string,string>>({}),[reasons,setReasons]=useState<Record<string,string>>({});
 const endpoint='/api/treasury/cheques'+(asOwner?'?mode=platform':'');
 const load=useCallback(async()=>{
  const res=await fetch(endpoint+(endpoint.includes('?')?'&':'?')+'company='+encodeURIComponent(companyId),{cache:'no-store'});
  const value=await res.json();
  if(!res.ok)throw Error(value.error||'LOAD_FAILED');
  setCheques(value.cheques||[]);
 },[companyId,endpoint]);
 useEffect(()=>{let live=true;void load().then(()=>{if(live)setLoaded(true)}).catch(()=>{if(live)setMessage(tr('تعذر تحميل الشيكات.','Could not load cheques.'))});return()=>{live=false};},[load]);
 async function submit(body:Record<string,unknown>){
  setBusy(true);setMessage('');
  try{
   const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company_id:companyId,...body})});
   const value=await res.json();
   if(!res.ok)throw Error(value.error||'CHEQUE_FAILED');
   setReference('');setAmount('');await load();
   window.dispatchEvent(new Event('bunyra:commercial-changed'));
   setMessage(tr('تم تسجيل العملية.','Operation recorded.'));
  }catch(err){setMessage(err instanceof Error?err.message:'CHEQUE_FAILED')}finally{setBusy(false)}
 }
 const selected=due.find(x=>x.id===dueId);
 return <div className="commercial-table" aria-label={tr('إدارة الشيكات','Cheque management')}>
  <h4>{tr('دورة حياة الشيكات','Cheque lifecycle')}</h4>
  <p className="muted">{tr('إصدار الشيك لا يضيف للمقبوضات. التحصيل الفعلي فقط يُحدّث القسط والدفاتر.','Issuing a cheque does not count as collected cash; only clearing it updates installments and the ledger.')}</p>
  {canFinance&&!asOwner&&<form className="compact-form" onSubmit={e=>{e.preventDefault();if(!selected)return;void submit({operation:'issue',contract_id:selected.contract_id,installment_id:selected.id,amount,reference})}}>
   <div className="form-grid">
    <label>{tr('القسط','Installment')}
     <select required value={dueId} onChange={e=>{const item=due.find(d=>d.id===e.target.value);setDueId(e.target.value);setAmount(item?formatMinor((BigInt(item.amount_minor)-BigInt(item.paid_minor)).toString()):'');}}>
      <option value="">{tr('اختر القسط','Select installment')}</option>
      {due.map(i=><option key={i.id} value={i.id}>{i.contract_number} · {i.customer_name} · {formatMinor((BigInt(i.amount_minor)-BigInt(i.paid_minor)).toString())} {i.currency_code}</option>)}
     </select>
    </label>
    <label>{tr('قيمة الشيك','Cheque amount')}
     <input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={amount} onChange={e=>setAmount(e.target.value)}/>
    </label>
    <label>{tr('رقم الشيك / المرجع','Cheque reference')}
     <input required minLength={3} maxLength={120} value={reference} onChange={e=>setReference(e.target.value)}/>
    </label>
   </div>
   <button className="primary" type="submit" disabled={busy||!selected}>{tr('تسجيل شيك تحت التحصيل','Register pending cheque')}</button>
  </form>}
  {message&&<p role="status">{message}</p>}
  {!loaded&&!message&&<p role="status">{tr('جاري تحميل الشيكات...','Loading cheques...')}</p>}
  {cheques.map(item=>{
   const pending=item.cheque_state==='PENDING',accountId=selectedAccount[item.id]||'';
   const account=accounts.find(x=>x.id===accountId);
   return <div className="commercial-row" key={item.id}>
    <span>
     <strong>{item.contract_number} · {item.customer_name}</strong>
     <small>{formatMinor(item.amount_minor)} {item.currency_code} · {item.reference_number}</small>
     <small>{item.cheque_state==='PENDING'?tr('تحت التحصيل','Pending'):item.cheque_state==='CLEARED'?tr('تم التحصيل','Cleared'):tr('مرتد','Bounced')}</small>
    </span>
    {pending&&canFinance&&!asOwner&&<div className="row-actions">
     <select aria-label={tr('حساب التحصيل','Collection account')} value={accountId}
      onChange={e=>setSelectedAccount(old=>({...old,[item.id]:e.target.value}))}>
      <option value="">{tr('اختر حسابًا','Choose an account')}</option>
      {accounts.filter(a=>a.currency_code===item.currency_code).map(a=><option value={a.id} key={a.id}>{a.name}</option>)}
     </select>
     {account&&account.currency_code!=='EGP'&&<input aria-label={tr('سعر الصرف','Exchange rate')}
      value={rates[item.id]||''} inputMode="decimal" placeholder="1.0000" onChange={e=>setRates(old=>({...old,[item.id]:e.target.value}))}/>}
     <button disabled={busy||!accountId||(account?.currency_code!=='EGP'&&!rates[item.id])} onClick={()=>void submit({
      operation:'clear',receipt_id:item.id,payment_account_id:accountId,
      exchange_rate:account?.currency_code==='EGP'?'1':rates[item.id]
     })}>{tr('تحصيل','Clear')}</button>
     <input aria-label={tr('سبب الارتداد','Bounce reason')} value={reasons[item.id]||''}
      minLength={3} maxLength={500} onChange={e=>setReasons(old=>({...old,[item.id]:e.target.value}))}/>
     <button disabled={busy||(reasons[item.id]||'').trim().length<3}
      onClick={()=>void submit({operation:'bounce',receipt_id:item.id,reason:reasons[item.id]})}>{tr('ارتداد','Bounce')}</button>
    </div>}
   </div>;
  })}
  {loaded&&!cheques.length&&<p className="muted">{tr('لا توجد شيكات مسجلة.','No cheques recorded.')}</p>}
 </div>;
}
