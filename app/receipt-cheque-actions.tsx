'use client';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
export function ChequeActions({id,company,currency,accounts}:{id:string;company:string;currency:string;accounts:{id:string;name:string;currency_code:string}[]}){
 const router=useRouter(),[mode,setMode]=useState<'CLEARED'|'BOUNCED'|null>(null);
 const [reason,setReason]=useState(''),[account,setAccount]=useState(''),[rate,setRate]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(){
  if(!mode)return;
  setBusy(true);setError('');
  const body=mode==='BOUNCED'?{company_id:company,action:mode,reason:reason.trim()}:{company_id:company,action:mode,payment_account_id:account,...(currency==='EGP'?{}:{exchange_rate:rate})};
  try{
   const res=await fetch('/api/receipts/'+encodeURIComponent(id)+'/cheque-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await res.json();
   if(!res.ok)throw Error(data.error||'CHEQUE_STATUS_FAILED');
   setMode(null);router.refresh();
  }catch(e){setError(e instanceof Error?e.message:'CHEQUE_STATUS_FAILED')}finally{setBusy(false);}
 }
 return <div className="treasury-actions">
 <button onClick={()=>setMode('CLEARED')}>تحصيل</button><button onClick={()=>setMode('BOUNCED')}>ارتداد</button>
 {mode&&<div className="treasury-overlay"><div role="dialog" aria-modal="true" aria-label="إدارة الشيك" className="treasury-modal">
  <h3>{mode==='BOUNCED'?'سبب ارتداد الشيك':'تحصيل الشيك'}</h3>
  {mode==='BOUNCED'?<label>سبب الارتداد<textarea autoFocus value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label>:
  <><label>حساب التحصيل<select autoFocus value={account} onChange={e=>setAccount(e.target.value)}>
  <option value="">اختر الحساب</option>{accounts.filter(a=>a.currency_code===currency).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
  </select></label>{currency!=='EGP'&&<label>سعر الصرف<input value={rate} onChange={e=>setRate(e.target.value)} inputMode="decimal"/></label>}</>}
  {error&&<p role="alert">{error}</p>}
  <button onClick={()=>setMode(null)} disabled={busy}>إلغاء</button>
  <button className="primary" disabled={busy||(mode==='BOUNCED'?reason.trim().length<3:!account||(currency!=='EGP'&&!rate))} onClick={()=>void submit()}>{busy?'جارٍ الحفظ...':'تأكيد'}</button>
 </div></div>}
 </div>;
}
