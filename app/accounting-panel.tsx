'use client';
import {useEffect,useState,type FormEvent,type ReactNode} from 'react';
import {BookOpen,Building2,Landmark,Receipt,RefreshCw} from 'lucide-react';
import styles from './accounting-panel.module.css';

type Section='ledger'|'vendor-payables'|'fixed-assets'|'treasury'|'accounting-reports';
type AssetData={assets:any[]};
type ListData={entities:any[];accounts:any[];journals:any[];entries:any[];projects:{id:string;name:string}[]};
type EventData={events:any[];mappings:any[]};
type VendorData={vendors:any[];bills:any[];mappings:any[]};
type TreasuryData={statements:any[];lines:any[];matches:any[];candidates:any[]};
type Report={summary:any;trial_balance:any[];project_analytics:any[];profit_and_loss:{lines:any[];income_minor:string;expenses_minor:string;net_profit_minor:string};balance_sheet:{lines:any[];assets_minor:string;liabilities_minor:string;equity_minor:string;accumulated_earnings_minor:string;total_liabilities_and_equity_minor:string;balanced:boolean}};
function minor(value:string){const m=/^(-?)(\d{1,14})(?:\.(\d{1,2}))?$/.exec(value.trim());if(!m)throw Error('INVALID_AMOUNT');return (BigInt(m[1]+m[2])*BigInt(100)+(m[1]?BigInt(-1):BigInt(1))*BigInt((m[3]||'').padEnd(2,'0'))).toString();}
function showMoney(value:unknown,en:boolean){try{const n=BigInt(String(value||0)),sign=n<BigInt(0)?'-':'',abs=n<BigInt(0)?-n:n;
 return sign+(abs/BigInt(100)).toLocaleString(en?'en-EG':'ar-EG')+'.'+(abs%BigInt(100)).toString().padStart(2,'0')+' EGP';
 }catch{return '—';}}
function today(){return new Date().toISOString().slice(0,10);}
const initialDate=today();
function nextAssetMonth(start:string,postedMonths:number){
 const d=new Date(start.slice(0,7)+'-01T00:00:00Z');
 if(!Number.isFinite(d.getTime())||!Number.isInteger(postedMonths))return '';
 d.setUTCMonth(d.getUTCMonth()+postedMonths);
 return d.toISOString().slice(0,10);
}
export default function AccountingPanel({companyId,en=false,asOwner=false,section='ledger',active=true}:{companyId:string;en?:boolean;asOwner?:boolean;section?:Section;active?:boolean}){
 const t=(ar:string,english:string)=>en?english:ar;
 const [ledger,setLedger]=useState<ListData|null>(null),[events,setEvents]=useState<EventData|null>(null);
 const [payables,setPayables]=useState<VendorData|null>(null),[treasury,setTreasury]=useState<TreasuryData|null>(null);
 const [controls,setControls]=useState<{periods:any[];reversals:any[]}|null>(null);
 const [assetData,setAssetData]=useState<AssetData|null>(null);
 const [assetForm,setAssetForm]=useState({code:'',name:'',project_id:'',acquisition_date:initialDate,service_date:initialDate,cost:'',residual:'0',life_months:'60',asset_account_id:'',accumulated_account_id:'',expense_account_id:'',journal_id:''});
 const [lockForm,setLockForm]=useState({from:initialDate.slice(0,7)+'-01',to:initialDate,reason:''}),[reverseForm,setReverseForm]=useState({entry_id:'',date:initialDate,reason:''});
 const [report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 const [entity,setEntity]=useState(''),[from,setFrom]=useState(initialDate.slice(0,4)+'-01-01'),[to,setTo]=useState(initialDate),[reportProject,setReportProject]=useState('');
 const [account,setAccount]=useState({code:'',name:'',kind:'expense',role:'general'}),[journal,setJournal]=useState({code:'',name:'',kind:'general'});
 const [voucher,setVoucher]=useState({reference:'',journal_id:'',debit_id:'',credit_id:'',amount:'',entry_date:initialDate});
 const [mapping,setMapping]=useState({journal_id:'',cash_account_id:'',advance_account_id:''});
 const [apMapping,setApMapping]=useState({journal_id:'',payable_account_id:''});
 const [vendor,setVendor]=useState({code:'',name:'',tax_registration:''});
 const [bill,setBill]=useState({vendor_id:'',invoice_number:'',expense_account_id:'',description:'',amount:'',invoice_date:initialDate,due_date:initialDate});
 const [bank,setBank]=useState({bank_account_id:'',statement_ref:'',date_from:initialDate,date_to:initialDate,opening:'0',closing:'0'});
 const [movement,setMovement]=useState({statement_id:'',external_ref:'',booked_on:initialDate,signed_amount:'',description:''});
 const [matching,setMatching]=useState<Record<string,string>>({});
 const root='/api/',query='?company='+encodeURIComponent(companyId)+(asOwner?'&mode=platform':'');
 const entityId=entity||ledger?.entities?.find(e=>e.is_default)?.id||ledger?.entities?.[0]?.id||'';
 async function fetchJson(url:string){
  const res=await fetch(url,{cache:'no-store'});
  const body=await res.json();
  if(!res.ok)throw Error(res.status===503?'MIGRATIONS_PENDING':body.error||'REQUEST_FAILED');
  return body;
 }
 useEffect(()=>{
  if(!active)return;
  let cancel=false;setLoading(true);setError('');
  void Promise.all(['ledger','finance-events','vendor-payables','treasury','ledger/controls'].map(key=>fetchJson(root+key+query)))
    .then(([gl,ev,ap,bank,ctrl])=>{if(cancel)return;setLedger(gl);setEvents(ev);setPayables(ap);setTreasury(bank);setControls(ctrl);})
    .catch(e=>{if(!cancel)setError(e instanceof Error?e.message:'LOAD_FAILED')})
    .finally(()=>{if(!cancel)setLoading(false)});
  return()=>{cancel=true};
 },[companyId,asOwner,revision,active]);
 useEffect(()=>{
  if(!active||section!=='fixed-assets')return;
  let cancel=false;setAssetData(null);
  void fetchJson(root+'fixed-assets'+query).then(data=>{if(!cancel){setAssetData(data);setError('')}})
   .catch(e=>{if(!cancel)setError(e instanceof Error?e.message:'ASSET_LOAD_FAILED')});
  return()=>{cancel=true};
 },[companyId,asOwner,section,revision,active]);
 useEffect(()=>{
  if(!active||section!=='accounting-reports'||!entityId)return;
  let cancel=false;setReport(null);
  const url=root+'ledger/reports'+query+'&entity='+encodeURIComponent(entityId)+'&from='+from+'&to='+to+(reportProject?'&project='+encodeURIComponent(reportProject):'');
  void fetchJson(url).then(x=>{if(!cancel){setReport(x);setError('')}}).catch(e=>{if(!cancel)setError(e instanceof Error?e.message:'REPORT_FAILED')});
  return()=>{cancel=true};
 },[companyId,asOwner,section,entityId,from,to,reportProject,revision,active]);
 async function action(endpoint:string,operation:string,payload:Record<string,unknown>){
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{
   const res=await fetch(root+endpoint+(asOwner?'?mode=platform':''),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({operation,company_id:companyId,...payload})
   });
   const response=await res.json();
   if(!res.ok)throw Error(response.error||'SAVE_FAILED');
   setNotice(t('تم تنفيذ العملية بنجاح.','Operation completed.'));
   setRevision(v=>v+1);
  }catch(e){setError(e instanceof Error?e.message:'SAVE_FAILED')}
  finally{setBusy(false)}
 }
 const submit=(fn:()=>void)=>(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();fn()};
 const renderTable=(columns:{key:string;ar:string;english:string;fmt?:(r:any)=>ReactNode}[],rows:any[])=><div className={styles.tableWrap}><table className={styles.table}><thead><tr>{columns.map(c=><th key={c.key}>{t(c.ar,c.english)}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.id||r.code||i}>{columns.map(c=><td key={c.key}>{c.fmt?c.fmt(r):String(r[c.key]??'—')}</td>)}</tr>)}{!rows.length&&<tr><td colSpan={columns.length}>{t('لا توجد بيانات حتى الآن','No records yet')}</td></tr>}</tbody></table></div>;
 const aOpts=(kinds:string[])=>(ledger?.accounts||[]).filter(a=>a.entity_id===entityId&&(kinds.includes(a.role)||kinds.includes(a.kind)));
 const journals=(ledger?.journals||[]).filter(j=>j.entity_id===entityId);
 const chosenMapping=events?.mappings?.find(m=>m.entity_id===entityId);
 const chosenAPMapping=payables?.mappings?.find(m=>m.entity_id===entityId);
 const unMatched=(treasury?.lines||[]).filter(l=>!treasury?.matches?.some(m=>m.bank_line_id===l.id));
 const labels:Record<Section,[string,string]>={ledger:['دفتر الأستاذ وشجرة الحسابات','General ledger & accounts'],'vendor-payables':['الموردون والفواتير المستحقة','Vendors & payables'],'fixed-assets':['الأصول الثابتة والإهلاك','Fixed assets & depreciation'],treasury:['الخزينة والمطابقة البنكية','Treasury & bank reconciliation'],'accounting-reports':['التقارير المالية','Financial reports']};
 return <section className={styles.root}>
  <div className={styles.header}><div><div className={styles.eyebrow}>BUNYRA ERP · ACCOUNTING</div><h2>{t(...labels[section])}</h2><p>{t('كل حركة مالية مرتبطة بمستندها الأصلي وتُرحّل إلى دفتر الأستاذ وفق صلاحيات الحسابات.','Financial records stay tied to their source documents and protected journal entries.')}</p></div>
   <button className="secondary" onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/>{t('تحديث','Refresh')}</button>
  </div>
  {error&&<div className={styles.error} role="alert">{error==='MIGRATIONS_PENDING'?t('قاعدة الشركة تحتاج تفعيل ترحيلات الحسابات 039–042 قبل استخدام هذه الشاشة. لم يتم تعديل بيانات الإنتاج.','Accounting database migrations 039–042 are not active for this company yet.'):t('تعذر إكمال الطلب: ','Request error: ')+error}</div>}
  {notice&&<div className={styles.notice} role="status">{notice}</div>}
  {loading&&<p className={styles.muted}>{t('جارٍ تحميل السجلات المحاسبية...','Loading accounting records...')}</p>}
  {ledger&&<div className={styles.toolbar}><label>{t('الكيان المحاسبي','Accounting entity')}<select value={entityId} onChange={e=>setEntity(e.target.value)}>{ledger.entities.map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select></label></div>}
  {section==='ledger'&&ledger&&<>
   <div className={styles.metrics}>
    <div><BookOpen size={19}/><strong>{ledger.accounts.length}</strong><span>{t('حساب محاسبي','GL accounts')}</span></div>
    <div><Receipt size={19}/><strong>{ledger.entries.filter(e=>e.state==='posted').length}</strong><span>{t('قيود مرحّلة حديثة','Recent posted journals')}</span></div>
    <div><Landmark size={19}/><strong>{events?.events.filter(e=>e.status==='pending').length||0}</strong><span>{t('أحداث تنتظر الترحيل','Events awaiting posting')}</span></div>
   </div>
   <div className={styles.columns}>
    <form className={styles.card} onSubmit={submit(()=>void action('ledger','account',{entity_id:entityId,...account}))}>
     <h3>{t('إضافة حساب لشجرة الحسابات','Add chart account')}</h3>
     <input placeholder={t('كود الحساب','Account code')} value={account.code} onChange={e=>setAccount({...account,code:e.target.value})} required/>
     <input placeholder={t('اسم الحساب','Account name')} value={account.name} onChange={e=>setAccount({...account,name:e.target.value})} required/>
     <select value={account.kind} onChange={e=>setAccount({...account,kind:e.target.value})}>{[['asset','أصل','Asset'],['liability','التزام','Liability'],['equity','حقوق ملكية','Equity'],['income','إيراد','Income'],['expense','مصروف','Expense']].map(x=><option key={x[0]} value={x[0]}>{en?x[2]:x[1]}</option>)}</select>
     <select value={account.role} onChange={e=>setAccount({...account,role:e.target.value})}>{['general','receivable','payable','cash','bank','customer_advance','tax','clearing'].map(x=><option key={x} value={x}>{x}</option>)}</select>
     <button className="primary" disabled={busy}>{t('حفظ الحساب','Save account')}</button>
    </form>
    <form className={styles.card} onSubmit={submit(()=>void action('ledger','journal',{entity_id:entityId,...journal}))}>
     <h3>{t('إضافة يومية محاسبية','Add journal')}</h3>
     <input placeholder={t('كود اليومية','Journal code')} value={journal.code} onChange={e=>setJournal({...journal,code:e.target.value})} required/>
     <input placeholder={t('اسم اليومية','Journal name')} value={journal.name} onChange={e=>setJournal({...journal,name:e.target.value})} required/>
     <select value={journal.kind} onChange={e=>setJournal({...journal,kind:e.target.value})}>{['general','sales','purchase','cash','bank','payroll','adjustment'].map(x=><option key={x} value={x}>{x}</option>)}</select>
     <button className="primary" disabled={busy}>{t('حفظ اليومية','Save journal')}</button>
    </form>
   </div>
   <h3>{t('شجرة الحسابات','Chart of accounts')}</h3>
   {renderTable([{key:'code',ar:'الكود',english:'Code'},{key:'name',ar:'الاسم',english:'Account'},{key:'kind',ar:'النوع',english:'Kind'},{key:'role',ar:'التصنيف',english:'Role'}],ledger.accounts.filter(x=>x.entity_id===entityId).slice(0,100))}
   <form className={styles.card} onSubmit={submit(()=>{let amount:string;try{amount=minor(voucher.amount)}catch{setError('INVALID_AMOUNT');return}void action('ledger','draft',{entity_id:entityId,journal_id:voucher.journal_id,entry_date:voucher.entry_date,reference:voucher.reference,idempotency_key:crypto.randomUUID(),lines:[{account_id:voucher.debit_id,debit_minor:amount,credit_minor:'0'},{account_id:voucher.credit_id,debit_minor:'0',credit_minor:amount}]})})}>
    <h3>{t('قيد يومية يدوي متوازن','Create balanced manual journal draft')}</h3>
    <div className={styles.fields}>
     <input placeholder={t('مرجع القيد','Journal reference')} value={voucher.reference} onChange={e=>setVoucher({...voucher,reference:e.target.value})} required/>
     <input type="date" value={voucher.entry_date} onChange={e=>setVoucher({...voucher,entry_date:e.target.value})}/>
     <select value={voucher.journal_id} onChange={e=>setVoucher({...voucher,journal_id:e.target.value})} required><option value="">{t('اختر اليومية','Select journal')}</option>{journals.map(j=><option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}</select>
     <select value={voucher.debit_id} onChange={e=>setVoucher({...voucher,debit_id:e.target.value})} required><option value="">{t('الحساب المدين','Debit account')}</option>{ledger.accounts.filter(x=>x.entity_id===entityId).map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select>
     <select value={voucher.credit_id} onChange={e=>setVoucher({...voucher,credit_id:e.target.value})} required><option value="">{t('الحساب الدائن','Credit account')}</option>{ledger.accounts.filter(x=>x.entity_id===entityId).map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select>
     <input value={voucher.amount} placeholder={t('المبلغ بالجنيه','Amount in EGP')} onChange={e=>setVoucher({...voucher,amount:e.target.value})} required/>
    </div><button className="primary" disabled={busy}>{t('إنشاء مسودة القيد','Create draft')}</button>
   </form>
   <div className={styles.columns}>
    <form className={styles.card} onSubmit={submit(()=>void action('ledger/controls','lock_period',{entity_id:entityId,...lockForm}))}>
      <h3>{t('إقفال فترة مالية','Lock accounting period')}</h3>
      <label>{t('من','From')}<input required type="date" value={lockForm.from} onChange={e=>setLockForm({...lockForm,from:e.target.value})}/></label>
      <label>{t('إلى','To')}<input required type="date" value={lockForm.to} onChange={e=>setLockForm({...lockForm,to:e.target.value})}/></label>
      <input required placeholder={t('سبب الإقفال','Reason for locking')} value={lockForm.reason} onChange={e=>setLockForm({...lockForm,reason:e.target.value})}/>
      <button className="primary" disabled={busy}>{t('قفل الفترة بعد مراجعة القيود','Lock period')}</button>
      <p className={styles.muted}>{t('يتم الرفض إذا كانت هناك قيود مسودة أو أحداث مالية لم تُرحّل.','Blocked if unposted drafts or pending events remain.')}</p>
    </form>
    <form className={styles.card} onSubmit={submit(()=>void action('ledger/controls','reverse_journal',{entry_id:reverseForm.entry_id,date:reverseForm.date,reason:reverseForm.reason}))}>
      <h3>{t('عكس قيد يدوي مرحّل','Reverse a posted manual journal')}</h3>
      <select required value={reverseForm.entry_id} onChange={e=>setReverseForm({...reverseForm,entry_id:e.target.value})}><option value="">{t('اختر قيدًا يدويًا','Choose manual journal')}</option>{ledger.entries.filter(e=>e.entity_id===entityId&&e.state==='posted'&&e.source_type==='manual').map(e=><option value={e.id} key={e.id}>{e.reference}</option>)}</select>
      <input required type="date" value={reverseForm.date} onChange={e=>setReverseForm({...reverseForm,date:e.target.value})}/>
      <input required placeholder={t('سبب القيد العكسي','Reversal reason')} value={reverseForm.reason} onChange={e=>setReverseForm({...reverseForm,reason:e.target.value})}/>
      <button className="primary" disabled={busy}>{t('ترحيل قيد عكسي','Post reversal')}</button>
      <p className={styles.muted}>{t('القيود الناتجة من العقود والتحصيلات لا تُعكس يدويًا؛ تُعالج من المستند الأصلي.','Source-linked entries must be corrected through their original commercial documents.')}</p>
    </form>
   </div>
   {!!controls?.periods.length&&<p className={styles.muted}>{t('عدد الفترات المقفولة: ','Locked periods: ')+controls.periods.length}</p>}
   <h3>{t('آخر القيود','Recent journal entries')}</h3>
   {renderTable([{key:'reference',ar:'المرجع',english:'Reference'},{key:'entry_date',ar:'التاريخ',english:'Date'},{key:'state',ar:'الحالة',english:'State'},{key:'id',ar:'الإجراء',english:'Action',fmt:r=>r.state==='draft'?<button disabled={busy} onClick={()=>void action('ledger','post',{id:r.id})}>{t('ترحيل','Post')}</button>:t('مرحّل','Posted')}],ledger.entries.filter(x=>x.entity_id===entityId))}
   <div className={styles.columns}>
    <form className={styles.card} onSubmit={submit(()=>void action('finance-events','configure_mapping',{entity_id:entityId,...mapping}))}>
     <h3>{t('ربط حسابات المقبوضات','Receipts GL mapping')}</h3>
     {chosenMapping&&<p className={styles.muted}>{t('يوجد ربط مالي محفوظ.','Mapping already configured.')}</p>}
     <select required value={mapping.journal_id} onChange={e=>setMapping({...mapping,journal_id:e.target.value})}><option value="">{t('يومية التحصيل','Receipt journal')}</option>{journals.map(j=><option key={j.id} value={j.id}>{j.name}</option>)}</select>
     <select required value={mapping.cash_account_id} onChange={e=>setMapping({...mapping,cash_account_id:e.target.value})}><option value="">{t('حساب البنك / الصندوق','Cash / bank account')}</option>{aOpts(['cash','bank']).map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select>
     <select required value={mapping.advance_account_id} onChange={e=>setMapping({...mapping,advance_account_id:e.target.value})}><option value="">{t('حساب مقدمات العملاء','Customer advances')}</option>{aOpts(['customer_advance']).map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select>
     <button className="primary" disabled={busy}>{t('حفظ الربط','Save mapping')}</button>
    </form>
    <div className={styles.card}>
     <h3>{t('أحداث مالية تحتاج اعتماد الترحيل','Financial events awaiting posting')}</h3>
     {(events?.events||[]).filter(e=>e.status==='pending').slice(0,12).map(e=><div className={styles.compactRow} key={e.id}><span>{e.event_type} · {showMoney(e.amount_minor,en)}</span><button disabled={busy} onClick={()=>void action('finance-events','post_event',{event_id:e.id})}>{t('ترحيل','Post')}</button></div>)}
     {!events?.events.some(e=>e.status==='pending')&&<p className={styles.muted}>{t('لا توجد أحداث معلقة.','No pending events.')}</p>}
    </div>
   </div>
  </>}
  {section==='vendor-payables'&&ledger&&payables&&<>
   <div className={styles.metrics}><div><Building2 size={19}/><strong>{payables.vendors.length}</strong><span>{t('مورد ومقاول','Vendors')}</span></div><div><Receipt size={19}/><strong>{payables.bills.length}</strong><span>{t('فواتير الموردين','Vendor bills')}</span></div></div>
   <div className={styles.columns}>
    <form className={styles.card} onSubmit={submit(()=>void action('vendor-payables','vendor',vendor))}>
     <h3>{t('إضافة مورد / مقاول','Add vendor or contractor')}</h3>
     <input required placeholder={t('كود المورد','Vendor code')} value={vendor.code} onChange={e=>setVendor({...vendor,code:e.target.value})}/>
     <input required placeholder={t('اسم المورد','Vendor name')} value={vendor.name} onChange={e=>setVendor({...vendor,name:e.target.value})}/>
     <input placeholder={t('الرقم الضريبي (اختياري)','Tax registration (optional)')} value={vendor.tax_registration} onChange={e=>setVendor({...vendor,tax_registration:e.target.value})}/>
     <button className="primary" disabled={busy}>{t('حفظ المورد','Save vendor')}</button>
    </form>
    <form className={styles.card} onSubmit={submit(()=>void action('vendor-payables','payable_mapping',{entity_id:entityId,...apMapping}))}>
     <h3>{t('ربط اليومية والدائنين','Supplier payable account mapping')}</h3>
     {chosenAPMapping&&<p className={styles.muted}>{t('يوجد ربط محفوظ.','Mapping configured.')}</p>}
     <select required value={apMapping.journal_id} onChange={e=>setApMapping({...apMapping,journal_id:e.target.value})}><option value="">{t('يومية المشتريات','Purchase journal')}</option>{journals.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
     <select required value={apMapping.payable_account_id} onChange={e=>setApMapping({...apMapping,payable_account_id:e.target.value})}><option value="">{t('حساب الموردين الدائن','Payables account')}</option>{aOpts(['payable']).map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select>
     <button className="primary" disabled={busy}>{t('حفظ الربط','Save mapping')}</button>
    </form>
   </div>
   <form className={styles.card} onSubmit={submit(()=>{let amount:string;try{amount=minor(bill.amount)}catch{setError('INVALID_AMOUNT');return}
    void action('vendor-payables','bill',{entity_id:entityId,vendor_id:bill.vendor_id,invoice_number:bill.invoice_number,invoice_date:bill.invoice_date,due_date:bill.due_date,
      lines:[{expense_account_id:bill.expense_account_id,description:bill.description,amount_minor:amount}]})})}>
    <h3>{t('تسجيل فاتورة مورد ببند واحد','Create a single-line supplier bill')}</h3>
    <div className={styles.fields}>
     <select required value={bill.vendor_id} onChange={e=>setBill({...bill,vendor_id:e.target.value})}><option value="">{t('اختار المورد','Select vendor')}</option>{payables.vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
     <input required placeholder={t('رقم الفاتورة','Invoice number')} value={bill.invoice_number} onChange={e=>setBill({...bill,invoice_number:e.target.value})}/>
     <select required value={bill.expense_account_id} onChange={e=>setBill({...bill,expense_account_id:e.target.value})}><option value="">{t('حساب المصروف/الأصل','Expense or asset account')}</option>{aOpts(['expense','asset']).map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select>
     <input required placeholder={t('وصف البند','Line description')} value={bill.description} onChange={e=>setBill({...bill,description:e.target.value})}/>
     <input required placeholder={t('المبلغ بالجنيه','Amount in EGP')} value={bill.amount} onChange={e=>setBill({...bill,amount:e.target.value})}/>
     <input type="date" value={bill.invoice_date} onChange={e=>setBill({...bill,invoice_date:e.target.value})}/>
     <input type="date" value={bill.due_date} onChange={e=>setBill({...bill,due_date:e.target.value})}/>
    </div><button className="primary" disabled={busy}>{t('إنشاء الفاتورة','Create bill')}</button>
   </form>
   <h3>{t('فواتير الموردين','Supplier bills')}</h3>
   {renderTable([{key:'invoice_number',ar:'رقم الفاتورة',english:'Invoice'},{key:'total_minor',ar:'القيمة',english:'Amount',fmt:r=>showMoney(r.total_minor,en)},{key:'status',ar:'الحالة',english:'Status'},{key:'id',ar:'الإجراءات',english:'Actions',fmt:r=><div className={styles.actions}>{r.status==='draft'&&<button disabled={busy} onClick={()=>void action('vendor-payables','approve_bill',{bill_id:r.id})}>{t('اعتماد','Approve')}</button>}{r.status==='approved'&&<button disabled={busy} onClick={()=>void action('vendor-payables','post_bill',{bill_id:r.id})}>{t('ترحيل','Post')}</button>}</div>}],payables.bills.filter(b=>b.entity_id===entityId))}
  </>}
  {section==='treasury'&&ledger&&treasury&&<>
   <div className={styles.metrics}><div><Landmark size={19}/><strong>{treasury.statements.length}</strong><span>{t('كشف حساب بنكي','Statements')}</span></div><div><Receipt size={19}/><strong>{unMatched.length}</strong><span>{t('حركات لم تتطابق','Unreconciled movements')}</span></div></div>
   <div className={styles.columns}>
    <form className={styles.card} onSubmit={submit(()=>{try{void action('treasury','create_statement',{entity_id:entityId,bank_account_id:bank.bank_account_id,statement_ref:bank.statement_ref,date_from:bank.date_from,date_to:bank.date_to,opening_minor:minor(bank.opening),closing_minor:minor(bank.closing)})}catch{setError('INVALID_AMOUNT')}})}>
     <h3>{t('إضافة كشف بنك','Create bank statement')}</h3>
     <select required value={bank.bank_account_id} onChange={e=>setBank({...bank,bank_account_id:e.target.value})}><option value="">{t('الحساب البنكي','Bank GL account')}</option>{aOpts(['bank']).map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select>
     <input required value={bank.statement_ref} onChange={e=>setBank({...bank,statement_ref:e.target.value})} placeholder={t('مرجع الكشف','Statement reference')}/>
     <label>{t('من','From')}<input type="date" value={bank.date_from} onChange={e=>setBank({...bank,date_from:e.target.value})}/></label>
     <label>{t('إلى','To')}<input type="date" value={bank.date_to} onChange={e=>setBank({...bank,date_to:e.target.value})}/></label>
     <input value={bank.opening} onChange={e=>setBank({...bank,opening:e.target.value})} placeholder={t('الرصيد الافتتاحي بالجنيه','Opening balance EGP')}/>
     <input value={bank.closing} onChange={e=>setBank({...bank,closing:e.target.value})} placeholder={t('الرصيد الختامي بالجنيه','Closing balance EGP')}/>
     <button className="primary" disabled={busy}>{t('إضافة الكشف','Create statement')}</button>
    </form>
    <form className={styles.card} onSubmit={submit(()=>{try{void action('treasury','import_lines',{statement_id:movement.statement_id,lines:[{external_ref:movement.external_ref,booked_on:movement.booked_on,signed_minor:minor(movement.signed_amount),description:movement.description}]})}catch{setError('INVALID_AMOUNT')}})}>
     <h3>{t('إضافة حركة بنكية','Add bank movement')}</h3>
     <select required value={movement.statement_id} onChange={e=>setMovement({...movement,statement_id:e.target.value})}><option value="">{t('اختار كشف مفتوح','Select open statement')}</option>{treasury.statements.filter(s=>s.status==='open').map(s=><option key={s.id} value={s.id}>{s.statement_ref}</option>)}</select>
     <input required value={movement.external_ref} onChange={e=>setMovement({...movement,external_ref:e.target.value})} placeholder={t('مرجع حركة البنك','Bank transaction reference')}/>
     <input type="date" value={movement.booked_on} onChange={e=>setMovement({...movement,booked_on:e.target.value})}/>
     <input required value={movement.signed_amount} onChange={e=>setMovement({...movement,signed_amount:e.target.value})} placeholder={t('المبلغ (+ إيداع، - سحب)','Signed EGP (+deposit, -withdrawal)')}/>
     <input value={movement.description} onChange={e=>setMovement({...movement,description:e.target.value})} placeholder={t('الوصف','Description')}/>
     <button className="primary" disabled={busy}>{t('إضافة الحركة','Add movement')}</button>
    </form>
   </div>
   <h3>{t('كشوف الحسابات','Bank statements')}</h3>
   {renderTable([{key:'statement_ref',ar:'المرجع',english:'Reference'},{key:'date_to',ar:'نهاية الفترة',english:'Period end'},{key:'closing_minor',ar:'الرصيد الختامي',english:'Closing balance',fmt:r=>showMoney(r.closing_minor,en)},{key:'status',ar:'الحالة',english:'Status'},{key:'id',ar:'الإجراء',english:'Action',fmt:r=>r.status==='open'?<button disabled={busy} onClick={()=>void action('treasury','close_statement',{statement_id:r.id})}>{t('إقفال بعد المطابقة','Close when matched')}</button>:'—'}],treasury.statements.filter(s=>s.entity_id===entityId))}
   <h3>{t('مطابقة الحركات البنكية مع القيود','Bank movement to posted GL matching')}</h3>
   {unMatched.filter(l=>l.entity_id===entityId).slice(0,100).map(l=>{
    const statement=treasury.statements.find(s=>s.id===l.statement_id);
    const candidates=(treasury.candidates||[]).filter(c=>c.account_id===statement?.bank_account_id&&BigInt(c.debit_minor)-BigInt(c.credit_minor)===BigInt(l.signed_minor));
    return <div className={styles.compactRow} key={l.id}><span>{l.external_ref} · {showMoney(l.signed_minor,en)}</span>
      <select aria-label={t('القيد المقابل','Matching ledger entry')} value={matching[l.id]||''} onChange={e=>setMatching({...matching,[l.id]:e.target.value})}><option value="">{t('اختار بند قيد مطابق','Choose matching posted ledger line')}</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.reference} · {c.account_code}</option>)}</select>
      <button disabled={busy||!matching[l.id]} onClick={()=>void action('treasury','match_line',{bank_line_id:l.id,ledger_line_id:matching[l.id]})}>{t('مطابقة','Match')}</button>
     </div>;
   })}
  </>}
  {section==='fixed-assets'&&ledger&&<>
   <div className={styles.columns}>
    <form className={styles.card} onSubmit={submit(()=>void action('fixed-assets','create',{
     entity_id:entityId,project_id:assetForm.project_id||null,
     code:assetForm.code,name:assetForm.name,acquisition_date:assetForm.acquisition_date,service_date:assetForm.service_date,
     cost_minor:minor(assetForm.cost),residual_minor:minor(assetForm.residual),
     useful_life_months:Number(assetForm.life_months),
     asset_account_id:assetForm.asset_account_id,accumulated_account_id:assetForm.accumulated_account_id,
     expense_account_id:assetForm.expense_account_id,journal_id:assetForm.journal_id
    }))}>
     <h3>{t('تسجيل أصل ثابت','Register fixed asset')}</h3>
     <div className={styles.fields}>
      <label>{t('كود الأصل','Asset code')}<input required value={assetForm.code} onChange={e=>setAssetForm({...assetForm,code:e.target.value})}/></label>
      <label>{t('اسم الأصل','Asset name')}<input required value={assetForm.name} onChange={e=>setAssetForm({...assetForm,name:e.target.value})}/></label>
      <label>{t('تاريخ الشراء','Purchase date')}<input required type="date" value={assetForm.acquisition_date} onChange={e=>setAssetForm({...assetForm,acquisition_date:e.target.value})}/></label>
      <label>{t('تاريخ بدء الاستخدام','In-service date')}<input required type="date" value={assetForm.service_date} onChange={e=>setAssetForm({...assetForm,service_date:e.target.value})}/></label>
      <label>{t('تكلفة الأصل (جنيه)','Cost (EGP)')}<input required type="number" min="0.01" step="0.01" value={assetForm.cost} onChange={e=>setAssetForm({...assetForm,cost:e.target.value})}/></label>
      <label>{t('القيمة المتبقية (جنيه)','Residual value (EGP)')}<input required type="number" min="0" step="0.01" value={assetForm.residual} onChange={e=>setAssetForm({...assetForm,residual:e.target.value})}/></label>
      <label>{t('العمر الإنتاجي بالشهور','Useful life (months)')}<input required type="number" min="1" max="600" value={assetForm.life_months} onChange={e=>setAssetForm({...assetForm,life_months:e.target.value})}/></label>
      <label>{t('المشروع (اختياري)','Project (optional)')}<select value={assetForm.project_id} onChange={e=>setAssetForm({...assetForm,project_id:e.target.value})}><option value="">{t('أصل على مستوى الشركة','Company-level asset')}</option>{ledger.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {([['asset_account_id','حساب تكلفة الأصل','Asset cost account','asset'],['accumulated_account_id','حساب مجمع الإهلاك','Accumulated depreciation account','asset'],['expense_account_id','حساب مصروف الإهلاك','Depreciation expense account','expense']] as const).map(([key,ar,english,kind])=>
       <label key={key}>{t(ar,english)}<select required value={assetForm[key]} onChange={e=>setAssetForm({...assetForm,[key]:e.target.value})}><option value="">{t('اختر حسابًا','Select account')}</option>{ledger.accounts.filter(a=>a.entity_id===entityId&&a.kind===kind&&a.active).map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
      )}
      <label>{t('دفتر اليومية','Journal')}<select required value={assetForm.journal_id} onChange={e=>setAssetForm({...assetForm,journal_id:e.target.value})}><option value="">{t('اختر دفترًا','Select journal')}</option>{journals.filter(j=>j.active).map(j=><option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}</select></label>
     </div>
     <button disabled={busy||!entityId}>{t('تسجيل الأصل','Register asset')}</button>
     <p className={styles.muted}>{t('تسجيل الأصل لا يُسجّل شراءه أو يسحب من الخزينة تلقائيًا. سجّل فاتورة الشراء أو قيد الاقتناء منفصلًا لمنع ازدواج التكلفة.','Registration does not create a purchase or cash journal. Record acquisition separately through an approved bill or journal to prevent double posting.')}</p>
    </form>
   </div>
   <h3>{t('سجل الأصول وجدول الإهلاك','Asset register and depreciation')}</h3>
   {assetData&&renderTable([
    {key:'code',ar:'الكود',english:'Code'},
    {key:'name',ar:'الأصل',english:'Asset'},
    {key:'cost_minor',ar:'التكلفة',english:'Cost',fmt:r=>showMoney(r.cost_minor,en)},
    {key:'accumulated_depreciation_minor',ar:'مجمع الإهلاك',english:'Accumulated',fmt:r=>showMoney(r.accumulated_depreciation_minor,en)},
    {key:'cost_minor',ar:'القيمة الدفترية',english:'Book value',fmt:r=>showMoney((BigInt(r.cost_minor)-BigInt(r.accumulated_depreciation_minor)).toString(),en)},
    {key:'posted_months',ar:'الأشهر المرحّلة',english:'Months posted',fmt:r=>String(r.posted_months)+' / '+String(r.useful_life_months)},
    {key:'id',ar:'القيد التالي',english:'Next posting',fmt:r=>{
     const next=nextAssetMonth(r.service_date,Number(r.posted_months));
     const completed=Number(r.posted_months)>=Number(r.useful_life_months);
     return <button disabled={busy||completed||!next||next.slice(0,7)>initialDate.slice(0,7)}
      onClick={()=>void action('fixed-assets','post_depreciation',{asset_id:r.id,period_month:next})}>
      {completed?t('مكتمل','Complete'):t('ترحيل إهلاك ','Post depreciation ')+next.slice(0,7)}</button>;
    }}
   ],assetData.assets.filter(a=>a.entity_id===entityId))}
  </>}
  {section==='accounting-reports'&&ledger&&<>
   <div className={styles.toolbar}><label>{t('من تاريخ','From')}<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>{t('إلى تاريخ','To')}<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><label>{t('المشروع','Project')}<select value={reportProject} onChange={e=>setReportProject(e.target.value)}><option value="">{t('كل المشاريع / الشركة','All projects / company')}</option>{ledger.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
   {reportProject&&<p className={styles.muted}>{t('تقرير المشروع تحليلي وقد لا يتوازن إذا كانت بعض أطراف القيد بدون مشروع.','Project reports may not balance independently if journal legs lack project dimensions.')}</p>}
   {report&&<><div className={styles.metrics}>
    <div><Receipt size={19}/><strong>{showMoney(report.summary.income_minor,en)}</strong><span>{t('الإيرادات المرحّلة','Posted income')}</span></div>
    <div><BookOpen size={19}/><strong>{showMoney(report.summary.expenses_minor,en)}</strong><span>{t('المصروفات المرحّلة','Posted expenses')}</span></div>
    <div><Landmark size={19}/><strong>{showMoney(report.summary.profit_minor,en)}</strong><span>{t('صافي نتيجة الفترة','Net result for period')}</span></div>
   </div>
   <h3>{t('ميزان مراجعة حركة الفترة','Period activity trial balance')}</h3>
   <p className={styles.muted}>{report.summary.balanced?t('المدين يساوي الدائن.','Debit equals credit.'):t('يوجد عدم توازن يتطلب المراجعة!','Journal totals are not balanced!')}</p>
   {renderTable([{key:'code',ar:'الكود',english:'Code'},{key:'name',ar:'الحساب',english:'Account'},{key:'debit_minor',ar:'مدين',english:'Debit',fmt:r=>showMoney(r.debit_minor,en)},{key:'credit_minor',ar:'دائن',english:'Credit',fmt:r=>showMoney(r.credit_minor,en)}],report.trial_balance)}
   <h3>{t('قائمة الأرباح والخسائر','Profit & loss statement')}</h3>
   {renderTable([{key:'code',ar:'الكود',english:'Code'},{key:'name',ar:'الحساب',english:'Account'},{key:'kind',ar:'النوع',english:'Type',fmt:r=>r.kind==='income'?t('إيرادات','Income'):t('مصروفات','Expenses')},{key:'balance_minor',ar:'الرصيد',english:'Balance',fmt:r=>showMoney(r.balance_minor,en)}],report.profit_and_loss.lines)}
   <div className={styles.metrics}>
    <div><Receipt size={19}/><strong>{showMoney(report.profit_and_loss.income_minor,en)}</strong><span>{t('إيرادات الفترة','Period revenue')}</span></div>
    <div><BookOpen size={19}/><strong>{showMoney(report.profit_and_loss.expenses_minor,en)}</strong><span>{t('مصروفات الفترة','Period expenses')}</span></div>
    <div><Landmark size={19}/><strong>{showMoney(report.profit_and_loss.net_profit_minor,en)}</strong><span>{t('صافي الربح / الخسارة','Net profit / loss')}</span></div>
   </div>
   <h3>{t('الميزانية العمومية حتى تاريخ التقرير','Balance sheet as of report end date')}</h3>
   <p className={styles.muted}>{report.balance_sheet.balanced?t('المعادلة المحاسبية متوازنة للبيانات المحددة.','Accounting equation balances for the selected data.'):t('تنبيه: الميزانية غير متوازنة؛ راجع الأرصدة الافتتاحية وتوزيع المشاريع.','Warning: balance sheet does not reconcile; review opening balances and project allocation.')}</p>
   {renderTable([{key:'code',ar:'الكود',english:'Code'},{key:'name',ar:'الحساب',english:'Account'},{key:'kind',ar:'النوع',english:'Type',fmt:r=>r.kind==='asset'?t('أصول','Assets'):r.kind==='liability'?t('التزامات','Liabilities'):t('حقوق ملكية','Equity')},{key:'balance_minor',ar:'الرصيد التراكمي',english:'As-of balance',fmt:r=>showMoney(r.balance_minor,en)}],report.balance_sheet.lines)}
   <div className={styles.metrics}>
    <div><Landmark size={19}/><strong>{showMoney(report.balance_sheet.assets_minor,en)}</strong><span>{t('إجمالي الأصول','Total assets')}</span></div>
    <div><Receipt size={19}/><strong>{showMoney(report.balance_sheet.liabilities_minor,en)}</strong><span>{t('إجمالي الالتزامات','Total liabilities')}</span></div>
    <div><BookOpen size={19}/><strong>{showMoney(report.balance_sheet.equity_minor,en)}</strong><span>{t('حقوق الملكية المسجلة','Recorded equity')}</span></div>
    <div><Receipt size={19}/><strong>{showMoney(report.balance_sheet.accumulated_earnings_minor,en)}</strong><span>{t('الأرباح التراكمية غير المقفلة','Cumulative unclosed earnings')}</span></div>
    <div><Landmark size={19}/><strong>{showMoney(report.balance_sheet.total_liabilities_and_equity_minor,en)}</strong><span>{t('الالتزامات + حقوق الملكية + الأرباح','Liabilities + equity + earnings')}</span></div>
   </div>
   <h3>{t('التوزيع على المشروعات','Project allocation')}</h3>
   {renderTable([{key:'project_name',ar:'المشروع',english:'Project'},{key:'income_minor',ar:'إيرادات',english:'Income',fmt:r=>showMoney(r.income_minor,en)},{key:'expenses_minor',ar:'مصروفات',english:'Expenses',fmt:r=>showMoney(r.expenses_minor,en)}],report.project_analytics)}
   <p className={styles.muted}>{t('قوائم غير معتمدة بالعملة المصرية: الأرصدة الافتتاحية ومطابقة التوزيع على المشروعات شرط لصحة النتائج، ولا تُستخدم كقوائم ختامية رسمية.','Unaudited EGP statements: complete opening balances and verify project allocation before relying on statutory year-end figures.')}</p>
   </>}
  </>}
 </section>;
}
