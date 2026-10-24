'use client';
import {useEffect,useState,type FormEvent} from 'react';
import type {VendorAging,AgingBucket} from '../lib/bunyra/vendor-aging';
import {agingBucketLabel} from '../lib/bunyra/vendor-aging-format';
import {statementAmount} from '../lib/bunyra/vendor-statement-format';
import styles from './accounting-panel.module.css';
type Props={companyId:string;entityId:string;asOwner:boolean;en:boolean;vendors:{id:string;code:string;name:string}[]};
const buckets:AgingBucket[]=['current','days_1_30','days_31_60','days_61_90','days_91_plus'];
export default function VendorAgingPanel({companyId,entityId,asOwner,en,vendors}:Props){
 const t=(ar:string,eng:string)=>en?eng:ar,today=new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});
 const [fields,setFields]=useState({vendor:'',as_of:today}),[query,setQuery]=useState({...fields,page:1});
 const [data,setData]=useState<VendorAging|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[downloading,setDownloading]=useState(false);
 const url=(download=false)=>'/api/vendor-aging?'+new URLSearchParams({company:companyId,entity:entityId,...query,page:String(query.page),...(asOwner?{mode:'platform'}:{}),...(download?{format:'xlsx',language:en?'en':'ar'}:{})});
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setData(null);
  void fetch(url(),{signal:controller.signal,cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(!controller.signal.aborted)setData(d);}).catch(()=>{if(!controller.signal.aborted)setError(t('تعذر تحميل التقرير. راجع التاريخ والصلاحيات.','Could not load the report. Review the date and permissions.'));}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[query,companyId,entityId,asOwner,en]);
 function submit(e:FormEvent){e.preventDefault();setQuery({...fields,page:1})}
 async function download(){if(loading||downloading)return;setDownloading(true);setError('');try{const r=await fetch(url(true),{cache:'no-store'});if(!r.ok){const d=await r.json();throw Error(d.error)}const href=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=href;a.download='supplier-aging.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000)}catch(e){setError(e instanceof Error&&e.message==='AGING_EXPORT_LIMIT'?t('التقرير يتجاوز 10000 فاتورة. اختر موردًا لتصدير نطاق أصغر كاملًا.','More than 10000 invoices. Select a supplier to export a smaller complete scope.'):t('تعذر تصدير التقرير.','Report export failed.'))}finally{setDownloading(false)}}
 const money=(v:string)=>statementAmount(v)+(en?' EGP':' ج.م');
 return <div className={styles.root}><h3>{t('أعمار مستحقات الموردين والمقاولين','Supplier and contractor payable aging')}</h3>
  <p>{t('التصنيف حسب تاريخ استحقاق الفاتورة، مع احتساب السداد والخصومات والاستردادات والتصحيحات حتى التاريخ المختار. المبالغ المستحقة من المورد تُعرض منفصلة.','Aging uses invoice due dates and payments, credits, refunds and corrections through the selected date. Supplier receivables are shown separately.')}</p>
  <form className={styles.card} onSubmit={submit}><div className={styles.fields}>
   <label>{t('المورد / المقاول','Supplier / contractor')}<select value={fields.vendor} onChange={e=>setFields({...fields,vendor:e.target.value})}><option value="">{t('كل الموردين','All suppliers')}</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}</select></label>
   <label>{t('حتى تاريخ','As of date')}<input type="date" required value={fields.as_of} onChange={e=>setFields({...fields,as_of:e.target.value})}/></label>
  </div><button disabled={loading}>{t('عرض التقرير','Show report')}</button></form>
  {error&&<div role="alert" className={styles.error}>{error}</div>}{loading&&<p role="status">{t('جارٍ تحميل التقرير…','Loading report…')}</p>}
  {data&&<><p><strong>{data.vendor?data.vendor.code+' · '+data.vendor.name:t('كل الموردين','All suppliers')}</strong> — {data.entity.code} · {data.entity.name} — {data.as_of}</p>
   <div className={styles.metrics}>{buckets.map(b=><div key={b}><span>{agingBucketLabel(b,en)}</span><strong>{money(data.buckets[b])}</strong></div>)}</div>
   <div className={styles.metrics}>{[[t('المستحق للموردين','Payable to suppliers'),data.due_minor],[t('مستحق من الموردين','Receivable from suppliers'),data.receivable_minor],[t('الصافي','Net balance'),data.net_minor]].map(([label,value])=><div key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div>
   <p className={styles.notice}>{t('رصيد دفتر الأستاذ: ','General ledger balance: ')}{money(data.ledger_minor)} · {t('فرق غير موزع على الفواتير: ','Unallocated ledger difference: ')}{money(data.unallocated_minor)}{BigInt(data.unallocated_minor)!==BigInt(0)&&<><br/>{t('الفرق يشمل القيود المحاسبية خارج دورة الفواتير. راجع دفتر الأستاذ؛ لم نوزّعه على الفواتير تلقائيًا.','The difference includes ledger movements outside invoice workflows. Review the general ledger; no automatic invoice allocation was made.')}</>}</p>
   <button disabled={loading||downloading} onClick={download}>{t('تصدير التقرير كاملًا إلى Excel','Export complete report to Excel')}</button>
   <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{[t('المورد','Supplier'),t('الفاتورة','Invoice'),t('تاريخ الاستحقاق','Due date'),t('أيام التأخير','Days overdue'),t('فئة العمر','Aging bucket'),t('قيمة الفاتورة','Invoice amount'),t('الخصم','Credit'),t('المدفوع','Paid'),t('المسترد','Refund received'),t('مستحق للمورد','Payable'),t('مستحق من المورد','Receivable'),t('معرف الفاتورة','Invoice ID')].map(x=><th key={x}>{x}</th>)}</tr></thead>
    <tbody>{data.rows.map(r=><tr key={r.bill_id}><td>{r.vendor_code} · {r.vendor_name}</td><td>{r.invoice_number}</td><td>{r.due_date}</td><td>{BigInt(r.receivable_minor)>BigInt(0)?'—':r.days_overdue}</td><td>{BigInt(r.receivable_minor)>BigInt(0)?t('مستحق من المورد','Supplier receivable'):agingBucketLabel(r.bucket,en)}</td><td>{money(r.total_minor)}</td><td>{money(r.credited_minor)}</td><td>{money(r.paid_minor)}</td><td>{money(r.refunded_minor)}</td><td>{money(r.due_minor)}</td><td>{money(r.receivable_minor)}</td><td>{r.bill_id}</td></tr>)}{!data.rows.length&&<tr><td colSpan={12}>{t('لا توجد فواتير ذات رصيد مفتوح حتى التاريخ المختار.','No invoices with open balances at the selected date.')}</td></tr>}</tbody></table></div>
   <div className={styles.toolbar}><button disabled={loading||data.page<=1} onClick={()=>setQuery({...query,page:data.page-1})}>{t('السابق','Previous')}</button><span>{data.page} / {Math.max(1,Math.ceil(data.total/data.page_size))} · {data.total} {t('فاتورة','invoices')}</span><button disabled={loading||data.page*data.page_size>=data.total} onClick={()=>setQuery({...query,page:data.page+1})}>{t('التالي','Next')}</button></div>
  </>}
 </div>;
}
