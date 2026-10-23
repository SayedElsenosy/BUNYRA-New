'use client';
import {useEffect,useState,type FormEvent} from 'react';
import styles from './accounting-panel.module.css';
type Bill={id:string;entity_id:string;invoice_number:string;invoice_date:string;status:string;refundable_minor:string};
type Credit={id:string;entity_id:string;bill_id:string;invoice_number:string;reference:string;credit_date:string;reason:string;amount_minor:string;refundable_minor:string;posted_entry_id:string};
type Refund={id:string;entity_id:string;credit_id:string;payment_account_id:string;payment_account_name:string;received_on:string;reference:string;amount_minor:string;posted_entry_id:string};
type Account={id:string;entity_id:string;name:string;currency_code:string};
type Line={id:string;line_number:number;description:string;amount_minor:string;remaining_minor:string};
type Props={mode:'credits'|'refunds';companyId:string;entityId:string;en:boolean;asOwner:boolean;canApprove:boolean;bills:Bill[];credits:Credit[];refunds:Refund[];accounts:Account[];onChanged:()=>void};
function toMinor(value:string){const m=/^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(value.trim());if(!m)throw Error('INVALID_AMOUNT');const n=BigInt(m[1])*BigInt(100)+BigInt((m[2]||'').padEnd(2,'0'));if(n<=BigInt(0))throw Error('INVALID_AMOUNT');return n.toString();}
function major(value:string){const n=BigInt(value);return (n/BigInt(100)).toString()+'.'+(n%BigInt(100)).toString().padStart(2,'0');}
function today(){return new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});}
export default function VendorCreditsPanel({mode,companyId,entityId,en,asOwner,canApprove,bills,credits,refunds,accounts,onChanged}:Props){
 const t=(ar:string,eng:string)=>en?eng:ar,money=(value:string)=>major(value)+(en?' EGP':' ج.م');
 const [credit,setCredit]=useState({bill_id:'',reference:'',credit_date:today(),reason:''}),[lines,setLines]=useState<Line[]>([]),[amounts,setAmounts]=useState<Record<string,string>>({});
 const [refund,setRefund]=useState({credit_id:'',payment_account_id:'',received_on:today(),amount:'',reference:''});
 const [creditKey,setCreditKey]=useState(()=>crypto.randomUUID()),[refundKey,setRefundKey]=useState(()=>crypto.randomUUID());
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 const errorText=(code:string)=>({
  VENDOR_CREDIT_LINES_INVALID:t('راجع بنود الفاتورة والمبالغ المدخلة.','Review the invoice lines and amounts.'),
  VENDOR_CREDIT_EXCEEDS_LINE:t('الخصم يتجاوز المتبقي في أحد البنود. حدّث البنود وراجع المبلغ.','A credit exceeds the remaining amount on a line. Refresh the lines and review it.'),
  VENDOR_CREDIT_BEFORE_BILL:t('تاريخ الإشعار لا يمكن أن يسبق الفاتورة.','The credit date cannot precede the invoice.'),
  VENDOR_CREDIT_CONFLICT:t('الطلب مسجل بالفعل بتفاصيل مختلفة. حدّث السجل.','This request already exists with different details. Refresh the records.'),
  VENDOR_REFUND_EXCEEDS_CREDIT:t('المبلغ يتجاوز المستحق استرداده. حدّث السجل وراجع المبلغ والتاريخ.','The amount exceeds the refund due. Refresh and review the amount and date.'),
  VENDOR_REFUND_ACCOUNT_INVALID:t('اختر حساب بنك أو صندوق نشطًا بالجنيه المصري.','Choose an active EGP bank or cash account.'),
  VENDOR_REFUND_BEFORE_CREDIT:t('تاريخ الاستلام لا يمكن أن يسبق إشعار الخصم.','Receipt cannot precede the credit note.'),
  VENDOR_REFUND_CONFLICT:t('الاسترداد مسجل بالفعل بتفاصيل مختلفة.','This refund request already exists with different details.'),
  LEDGER_PERIOD_LOCKED:t('الفترة المالية مقفلة. اختر تاريخًا في فترة مفتوحة.','The accounting period is locked. Choose an open period.'),
  ALREADY_EXISTS:t('المرجع مسجل بالفعل. راجع السجل قبل إعادة المحاولة.','This reference is already recorded. Review the records before retrying.'),
  INVALID_AMOUNT:t('اكتب مبلغًا موجبًا بمنزلتين عشريتين بحد أقصى.','Enter a positive amount with up to two decimals.'),
  FORBIDDEN:t('لا تملك صلاحية اعتماد العملية.','You cannot approve this operation.')
 }[code]||t('تعذر تنفيذ العملية. راجع البيانات والصلاحيات.','The operation failed. Review the details and permissions.'));
 useEffect(()=>{const controller=new AbortController();setLines([]);setAmounts({});setLoading(false);if(!credit.bill_id)return;
  setLoading(true);setError('');void fetch('/api/vendor-payables?company='+encodeURIComponent(companyId)+'&bill_lines='+encodeURIComponent(credit.bill_id)+(asOwner?'&mode=platform':''),{signal:controller.signal,cache:'no-store'})
   .then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(!controller.signal.aborted)setLines(d.lines);})
   .catch(()=>{if(!controller.signal.aborted)setError(t('تعذر تحميل بنود الفاتورة.','Could not load invoice lines.'));})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
 },[companyId,credit.bill_id,asOwner,revision]);
 const creditChange=(v:Partial<typeof credit>)=>{setCredit(p=>({...p,...v}));setCreditKey(crypto.randomUUID());};
 const refundChange=(v:Partial<typeof refund>)=>{setRefund(p=>({...p,...v}));setRefundKey(crypto.randomUUID());};
 async function send(operation:string,body:Record<string,unknown>){
  const r=await fetch('/api/vendor-payables'+(asOwner?'?mode=platform':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,company_id:companyId,...body})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;
 }
 async function postCredit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy||loading||!canApprove)return;setBusy(true);setError('');setNotice('');
  try{const selected=lines.filter(l=>(amounts[l.id]||'').trim()).map(l=>{const amount=toMinor(amounts[l.id]);if(BigInt(amount)>BigInt(l.remaining_minor))throw Error('VENDOR_CREDIT_EXCEEDS_LINE');return {bill_line_id:l.id,amount_minor:amount};});
   if(!selected.length)throw Error('VENDOR_CREDIT_LINES_INVALID');await send('credit_note',{...credit,lines:selected,idempotency_key:creditKey});setCreditKey(crypto.randomUUID());setCredit(p=>({...p,reference:'',reason:''}));setAmounts({});setRevision(v=>v+1);setNotice(t('تم ترحيل إشعار الخصم وتحديث المستحقات.','Credit note posted and balances updated.'));onChanged();
  }catch(e){setError(errorText(e instanceof Error?e.message:''))}finally{setBusy(false);}}
 async function postRefund(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy||!canApprove)return;setBusy(true);setError('');setNotice('');
  try{const {amount,...body}=refund;await send('receive_refund',{...body,amount_minor:toMinor(amount),idempotency_key:refundKey});setRefundKey(crypto.randomUUID());setRefund(p=>({...p,amount:'',reference:'',payment_account_id:''}));setNotice(t('تم تسجيل المبلغ المستلم وترحيله إلى الحساب المختار.','Received refund posted to the selected account.'));onChanged();
  }catch(e){setError(errorText(e instanceof Error?e.message:''))}finally{setBusy(false);}}
 const visibleCredits=credits.filter(c=>c.entity_id===entityId),eligible=visibleCredits.filter(c=>BigInt(c.refundable_minor)>BigInt(0));
 return <div className={styles.root}>
  {error&&<div role="alert" className={styles.error}>{error}</div>}{notice&&<div role="status" className={styles.notice}>{notice}</div>}
  {mode==='credits'&&<form className={styles.card} onSubmit={postCredit}><h3>{t('إشعار خصم مورد مرتبط بفاتورة','Supplier credit note')}</h3>
   <p>{t('اختر بنود الفاتورة والمبلغ المخصوم من كل بند. الترحيل يقلل المصروف أو الأصل والدائنين، ويحفظ الفاتورة الأصلية.','Choose invoice lines and credit amounts. Posting reduces the original expense/asset and payable while preserving the invoice.')}</p>
   <div className={styles.fields}>
    <label>{t('الفاتورة الأصلية','Original invoice')}<select required value={credit.bill_id} onChange={e=>creditChange({bill_id:e.target.value})}><option value="">{t('اختر فاتورة مرحّلة','Choose a posted invoice')}</option>{bills.filter(b=>b.entity_id===entityId&&b.status==='posted').map(b=><option key={b.id} value={b.id}>{b.invoice_number}</option>)}</select></label>
    <label>{t('رقم إشعار المورد','Supplier credit reference')}<input required minLength={2} maxLength={100} value={credit.reference} onChange={e=>creditChange({reference:e.target.value})}/></label>
    <label>{t('تاريخ الإشعار','Credit date')}<input required type="date" value={credit.credit_date} onChange={e=>creditChange({credit_date:e.target.value})}/></label>
    <label>{t('سبب الخصم','Credit reason')}<input required minLength={3} maxLength={500} value={credit.reason} onChange={e=>creditChange({reason:e.target.value})}/></label>
   </div>
   {loading&&<p role="status">{t('جارٍ تحميل البنود…','Loading invoice lines…')}</p>}
   <div className={styles.tableWrap} style={{maxHeight:320}}><table className={styles.table}><thead><tr><th>{t('البند','Line')}</th><th>{t('المتبقي القابل للخصم','Remaining creditable')}</th><th>{t('مبلغ الخصم بالجنيه','Credit EGP')}</th></tr></thead><tbody>{lines.map(l=><tr key={l.id}><td>{l.line_number} · {l.description}</td><td>{money(l.remaining_minor)}</td><td><input aria-label={t('خصم البند ','Credit line ')+l.line_number} disabled={busy||!canApprove||BigInt(l.remaining_minor)===BigInt(0)} inputMode="decimal" value={amounts[l.id]||''} onChange={e=>{setAmounts({...amounts,[l.id]:e.target.value});setCreditKey(crypto.randomUUID());}}/></td></tr>)}</tbody></table></div>
   <button type="button" disabled={busy||loading||!credit.bill_id} onClick={()=>setRevision(v=>v+1)}>{t('تحديث البنود','Refresh lines')}</button>
   <button type="button" disabled={busy||loading||!canApprove||!lines.length} onClick={()=>{setAmounts(Object.fromEntries(lines.filter(l=>BigInt(l.remaining_minor)>BigInt(0)).map(l=>[l.id,major(l.remaining_minor)])));setCreditKey(crypto.randomUUID());}}>{t('تعبئة خصم المتبقي كاملًا','Fill full remaining credit')}</button>
   <button disabled={busy||loading||!canApprove||!lines.length}>{t('اعتماد وترحيل إشعار الخصم','Approve and post credit')}</button>
  </form>}
  {mode==='refunds'&&<form className={styles.card} onSubmit={postRefund}><h3>{t('تسجيل مبلغ مسترد تم استلامه من المورد','Record a received supplier refund')}</h3>
   <p>{t('يُستخدم بعد استلام المبلغ فعليًا. اختر الحساب المستلم ومرجع البنك أو الإيصال. هذه الشاشة تسجل الاستلام ولا تنفذ تحويلًا بنكيًا.','Use after receiving the money. Select its destination and bank/receipt reference. This records receipt and does not initiate a bank transfer.')}</p>
   <div className={styles.fields}>
    <label>{t('إشعار الخصم','Credit note')}<select required value={refund.credit_id} onChange={e=>refundChange({credit_id:e.target.value})}><option value="">{t('اختر مستحقًا للاسترداد','Choose a refundable credit')}</option>{eligible.map(c=><option key={c.id} value={c.id}>{c.reference} · {money(c.refundable_minor)}</option>)}</select></label>
    <label>{t('الحساب المستلم بالجنيه','Receiving EGP account')}<select required value={refund.payment_account_id} onChange={e=>refundChange({payment_account_id:e.target.value})}><option value="">{t('اختر البنك أو الصندوق','Choose bank or cash account')}</option>{accounts.filter(a=>a.entity_id===entityId&&a.currency_code==='EGP').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label>{t('المبلغ بالجنيه','Amount EGP')}<input required inputMode="decimal" value={refund.amount} onChange={e=>refundChange({amount:e.target.value})}/></label>
    <label>{t('تاريخ الاستلام','Received date')}<input required type="date" value={refund.received_on} onChange={e=>refundChange({received_on:e.target.value})}/></label>
    <label>{t('مرجع البنك أو الإيصال','Bank or receipt reference')}<input required minLength={2} maxLength={120} value={refund.reference} onChange={e=>refundChange({reference:e.target.value})}/></label>
   </div><button disabled={busy||!canApprove||!eligible.length}>{t('تسجيل الاستلام وترحيله','Post received refund')}</button>
  </form>}
  {mode==='credits'&&<><h3>{t('إشعارات الخصم المرحّلة','Posted credit notes')}</h3><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{t('الإشعار / الفاتورة','Credit / invoice')}</th><th>{t('التاريخ','Date')}</th><th>{t('المبلغ','Amount')}</th><th>{t('المتاح استرداده','Refund available')}</th><th>{t('السبب / القيد','Reason / GL')}</th></tr></thead><tbody>{visibleCredits.map(c=><tr key={c.id}><td>{c.reference} · {c.invoice_number||bills.find(b=>b.id===c.bill_id)?.invoice_number}</td><td>{c.credit_date}</td><td>{money(c.amount_minor)}</td><td>{money(c.refundable_minor)}</td><td>{c.reason} · {c.posted_entry_id.slice(0,8)}</td></tr>)}{!visibleCredits.length&&<tr><td colSpan={5}>{t('لا توجد إشعارات خصم حتى الآن.','No credit notes yet.')}</td></tr>}</tbody></table></div>
  </>}
  {mode==='refunds'&&<><h3>{t('المبالغ المستردة المسجلة','Recorded supplier refunds')}</h3><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{t('المرجع','Reference')}</th><th>{t('الحساب','Account')}</th><th>{t('التاريخ','Date')}</th><th>{t('المبلغ','Amount')}</th><th>{t('القيد','GL entry')}</th></tr></thead><tbody>{refunds.filter(r=>r.entity_id===entityId).map(r=><tr key={r.id}><td>{r.reference}</td><td>{r.payment_account_name||accounts.find(a=>a.id===r.payment_account_id)?.name||'—'}</td><td>{r.received_on}</td><td>{money(r.amount_minor)}</td><td>{r.posted_entry_id.slice(0,8)}</td></tr>)}{!refunds.some(r=>r.entity_id===entityId)&&<tr><td colSpan={5}>{t('لا توجد مبالغ مستردة مسجلة.','No refunds recorded.')}</td></tr>}</tbody></table></div>
  </>}
 </div>;
}
