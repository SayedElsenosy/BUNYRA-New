'use client';
import {useEffect,useState,type FormEvent} from 'react';
import type {VendorStatement} from '../lib/bunyra/vendor-statement';
import {statementAmount,statementEvent} from '../lib/bunyra/vendor-statement-format';
import styles from './accounting-panel.module.css';
type Props={companyId:string;entityId:string;asOwner:boolean;en:boolean;vendors:{id:string;code:string;name:string}[]};
function today(){return new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'})}
export default function VendorStatementPanel({companyId,entityId,asOwner,en,vendors}:Props){
 const t=(ar:string,eng:string)=>en?eng:ar,now=today();
 const [fields,setFields]=useState({vendor:'',from:now.slice(0,4)+'-01-01',to:now}),[query,setQuery]=useState<{vendor:string;from:string;to:string;page:number}|null>(null);
 const [data,setData]=useState<VendorStatement|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[downloading,setDownloading]=useState(false);
 const url=(q:NonNullable<typeof query>,download=false)=>'/api/vendor-statement?'+new URLSearchParams({company:companyId,entity:entityId,vendor:q.vendor,from:q.from,to:q.to,page:String(q.page),...(asOwner?{mode:'platform'}:{}),...(download?{format:'xlsx',language:en?'en':'ar'}:{})});
 useEffect(()=>{if(!query)return;const controller=new AbortController();setLoading(true);setError('');setData(null);
  void fetch(url(query),{signal:controller.signal,cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(!controller.signal.aborted)setData(d);}).catch(()=>{if(!controller.signal.aborted)setError(t('تعذر تحميل الكشف. راجع المورد والفترة والصلاحيات.','Could not load the statement. Review the vendor, dates and permissions.'));}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[query,companyId,entityId,asOwner,en]);
 function submit(e:FormEvent){e.preventDefault();if(fields.from>fields.to){setError(t('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.','Start date must not follow end date.'));return}setQuery({...fields,page:1})}
 async function download(){if(!query||loading||downloading)return;setDownloading(true);setError('');try{const r=await fetch(url(query,true),{cache:'no-store'});if(!r.ok){const d=await r.json();throw Error(d.error)}const href=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=href;a.download='supplier-statement.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000)}catch(e){setError(e instanceof Error&&e.message==='STATEMENT_EXPORT_LIMIT'?t('الكشف يتجاوز 10000 حركة. اختر فترة أصغر لتصديره كاملًا.','More than 10000 movements. Choose a shorter period to export the complete statement.'):t('تعذر تصدير الكشف.','Statement export failed.'))}finally{setDownloading(false)}}
 const m=(v:string)=>statementAmount(v)+(en?' EGP':' ج.م');
 return <div className={styles.root}>
  <h3>{t('كشف حساب المورد والمقاول','Supplier and contractor statement')}</h3>
  <p>{t('يعرض الحركات المرحّلة على حسابات ذمم المورد المختار بالجنيه المصري، ويشمل قيود التصحيح. الرصيد الموجب مستحق للمورد والسالب مستحق من المورد.','Shows posted EGP movements on the selected supplier payable accounts, including correction entries. Positive balances are payable; negative balances are receivable from the supplier.')}</p>
  <form className={styles.card} onSubmit={submit}><div className={styles.fields}>
   <label>{t('المورد / المقاول','Supplier / contractor')}<select required value={fields.vendor} onChange={e=>setFields({...fields,vendor:e.target.value})}><option value="">{t('اختر المورد','Choose supplier')}</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}</select></label>
   <label>{t('من تاريخ','From date')}<input required type="date" value={fields.from} onChange={e=>setFields({...fields,from:e.target.value})}/></label>
   <label>{t('إلى تاريخ','To date')}<input required type="date" value={fields.to} onChange={e=>setFields({...fields,to:e.target.value})}/></label>
  </div><button disabled={loading||!fields.vendor}>{t('عرض كشف الحساب','Show statement')}</button></form>
  {error&&<div role="alert" className={styles.error}>{error}</div>}{loading&&<p role="status">{t('جارٍ تحميل الكشف…','Loading statement…')}</p>}
  {!query&&<p>{t('اختر المورد والفترة لعرض كشفه.','Choose a supplier and date range to view the statement.')}</p>}
  {data&&<><p><strong>{data.vendor.code} · {data.vendor.name}</strong> — {data.entity.code} · {data.entity.name} — {data.from} / {data.to}</p>
   <div className={styles.metrics}>{[[t('رصيد أول المدة','Opening balance'),data.opening_minor],[t('إجمالي المدين','Total debits'),data.debit_minor],[t('إجمالي الدائن','Total credits'),data.credit_minor],[t('رصيد آخر المدة','Closing balance'),data.closing_minor]].map(([label,value])=><div key={label}><span>{label}</span><strong>{m(value)}</strong></div>)}</div>
   <button disabled={loading||downloading} onClick={download}>{t('تصدير الكشف كاملًا إلى Excel','Export complete statement to Excel')}</button>
   <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{[t('التاريخ','Date'),t('الحركة','Movement'),t('المرجع','Reference'),t('الوصف','Description'),t('مدين','Debit'),t('دائن','Credit'),t('الرصيد','Balance'),t('معرف القيد','Journal ID')].map(x=><th key={x}>{x}</th>)}</tr></thead>
    <tbody>{data.rows.map(r=><tr key={r.entry_id}><td>{r.entry_date}</td><td>{statementEvent(r,en)}</td><td>{r.reference}</td><td>{r.description}</td><td>{m(r.debit_minor)}</td><td>{m(r.credit_minor)}</td><td>{m(r.balance_minor)}</td><td>{r.entry_id}</td></tr>)}{!data.rows.length&&<tr><td colSpan={8}>{t('لا توجد حركات مرحّلة خلال الفترة المختارة.','No posted movements in the selected period.')}</td></tr>}</tbody></table></div>
   <div className={styles.toolbar}><button disabled={loading||data.page<=1} onClick={()=>setQuery({...query!,page:data.page-1})}>{t('السابق','Previous')}</button><span>{data.page} / {Math.max(1,Math.ceil(data.total/data.page_size))} · {data.total} {t('حركة','movements')}</span><button disabled={loading||data.page*data.page_size>=data.total} onClick={()=>setQuery({...query!,page:data.page+1})}>{t('التالي','Next')}</button></div>
  </>}
 </div>;
}
