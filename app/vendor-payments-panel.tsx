'use client';
import {useState,type FormEvent} from 'react';
import styles from './accounting-panel.module.css';

type Bill={id:string;entity_id:string;invoice_number:string;status:string;paid_minor:string;remaining_minor:string};
type Payment={id:string;bill_id:string;entity_id:string;paid_on:string;amount_minor:string;posted_entry_id:string};
type Account={id:string;entity_id:string;code:string;name:string;role:string;kind:string;active?:boolean;currency_code?:string};
type Journal={id:string;entity_id:string;name:string;kind:string;active?:boolean};
type Props={companyId:string;entityId:string;en:boolean;asOwner:boolean;bills:Bill[];payments:Payment[];
 accounts:Account[];journals:Journal[];onChanged:()=>void};
const toMinor=(v:string)=>{
 const m=/^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(v.trim());
 if(!m)throw Error('INVALID_AMOUNT');
 const minor=BigInt(m[1])*BigInt(100)+BigInt((m[2]||'').padEnd(2,'0'));
 if(minor<=BigInt(0))throw Error('INVALID_AMOUNT');
 return minor.toString();
};
const money=(minor:string,en:boolean)=>{
 try{const n=BigInt(minor),neg=n<BigInt(0),v=neg?-n:n;
  return (neg?'-':'')+(v/BigInt(100)).toLocaleString(en?'en-EG':'ar-EG-u-nu-latn')+
    '.'+(v%BigInt(100)).toString().padStart(2,'0')+(en?' EGP':' ج.م');
 }catch{return '—';}
};
export default function VendorPaymentsPanel({companyId,entityId,en,asOwner,bills,payments,accounts,journals,onChanged}:Props){
 const t=(ar:string,eng:string)=>en?eng:ar;
 const [input,setInput]=useState({bill_id:'',cash_account_id:'',journal_id:'',paid_on:new Date().toISOString().slice(0,10),amount:''});
 const [key,setKey]=useState(()=>crypto.randomUUID()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const change=(v:Partial<typeof input>)=>{setInput(p=>({...p,...v}));setKey(crypto.randomUUID());};
 const unpaid=bills.filter(b=>b.entity_id===entityId&&b.status==='posted'&&BigInt(b.remaining_minor||'0')>BigInt(0));
 const chosen=accounts.find(a=>a.id===input.cash_account_id);
 const cash=accounts.filter(a=>a.entity_id===entityId&&a.kind==='asset'&&['bank','cash'].includes(a.role)&&a.active!==false&&(a.currency_code||'EGP')==='EGP');
 const selectableJournals=journals.filter(j=>j.entity_id===entityId&&j.active!==false&&
   (chosen?j.kind===chosen.role:['cash','bank'].includes(j.kind)));
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const amount_minor=toMinor(input.amount);
   const bill=bills.find(b=>b.id===input.bill_id);
   if(!bill||bill.entity_id!==entityId||BigInt(amount_minor)>BigInt(bill.remaining_minor))
    throw Error('VENDOR_PAYMENT_OVERPAID');
   const result=await fetch('/api/vendor-payables'+(asOwner?'?mode=platform':''),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({operation:'pay_bill',company_id:companyId,bill_id:input.bill_id,
      cash_account_id:input.cash_account_id,journal_id:input.journal_id,paid_on:input.paid_on,
      amount_minor,idempotency_key:key})
   });
   const data=await result.json();
   if(!result.ok)throw Error(data.error||'VENDOR_PAYMENT_FAILED');
   setNotice(t('تم ترحيل سداد المورد إلى دفتر الأستاذ.','Supplier payment posted to the general ledger.'));
   setInput(prev=>({...prev,amount:''}));setKey(crypto.randomUUID());onChanged();
  }catch(err){setError(err instanceof Error?err.message:'VENDOR_PAYMENT_FAILED');}
  finally{setBusy(false);}
 }
 return <div className={styles.root}>
  <h3>{t('سداد فواتير الموردين','Supplier bill payments')}</h3>
  <p className={styles.muted}>{t('يمكن السداد جزئيًا أو كليًا بعد ترحيل الفاتورة. كل دفعة تنشئ قيدًا محاسبيًا متوازنًا ولا تسمح بتجاوز المتبقي.','Posted bills allow partial or full settlement. Each payment creates a balanced journal entry and cannot exceed the remaining amount.')}</p>
  {error&&<div className={styles.error} role="alert">{error}</div>}
  {notice&&<div className={styles.notice} role="status">{notice}</div>}
  <form className={styles.card} onSubmit={submit}>
   <div className={styles.fields}>
    <label>{t('الفاتورة المُرحّلة','Posted invoice')}
     <select required value={input.bill_id} onChange={e=>change({bill_id:e.target.value})}>
      <option value="">{t('اختر الفاتورة','Select invoice')}</option>
      {unpaid.map(b=><option key={b.id} value={b.id}>{b.invoice_number} — {money(b.remaining_minor,en)} {t('متبقي','remaining')}</option>)}
     </select>
    </label>
    <label>{t('حساب البنك / الصندوق','Bank / cash account')}
     <select required value={input.cash_account_id} onChange={e=>change({cash_account_id:e.target.value,journal_id:''})}>
      <option value="">{t('اختر الحساب','Select account')}</option>
      {cash.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
     </select>
    </label>
    <label>{t('يومية البنك / الصندوق','Bank / cash journal')}
     <select required value={input.journal_id} onChange={e=>change({journal_id:e.target.value})}>
      <option value="">{t('اختر اليومية','Select journal')}</option>
      {selectableJournals.map(j=><option key={j.id} value={j.id}>{j.name}</option>)}
     </select>
    </label>
    <label>{t('تاريخ السداد','Payment date')}
     <input required type="date" value={input.paid_on} onChange={e=>change({paid_on:e.target.value})}/>
    </label>
    <label>{t('المبلغ بالجنيه','Amount EGP')}
     <input required inputMode="decimal" placeholder="15000.00" value={input.amount}
      onChange={e=>change({amount:e.target.value})}/>
    </label>
   </div>
   <button disabled={busy||!input.bill_id||!input.cash_account_id||!input.journal_id||!input.amount} type="submit">
    {t('ترحيل السداد','Post payment')}
   </button>
  </form>
  <h3>{t('سجل عمليات سداد الموردين','Posted supplier payments')}</h3>
  <div className={styles.tableWrap}><table className={styles.table}>
   <thead><tr><th>{t('الفاتورة','Invoice')}</th><th>{t('التاريخ','Date')}</th><th>{t('المبلغ','Amount')}</th><th>{t('رقم القيد','GL entry')}</th></tr></thead>
   <tbody>{payments.filter(p=>p.entity_id===entityId).map(p=><tr key={p.id}>
    <td>{bills.find(b=>b.id===p.bill_id)?.invoice_number||p.bill_id}</td>
    <td>{p.paid_on}</td><td>{money(p.amount_minor,en)}</td><td>{p.posted_entry_id.slice(0,8)}</td>
   </tr>)}
   {!payments.some(p=>p.entity_id===entityId)&&<tr><td colSpan={4}>{t('لا توجد مدفوعات مورّدين حتى الآن.','No supplier payments yet.')}</td></tr>}
   </tbody>
  </table></div>
 </div>;
}
