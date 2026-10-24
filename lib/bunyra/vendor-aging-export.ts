import type {VendorAging} from './vendor-aging';
import {literalXlsx} from './literal-xlsx';
import {statementAmount as m} from './vendor-statement-format';
import {agingBucketLabel} from './vendor-aging-format';
export function vendorAgingXlsx(data:VendorAging,en:boolean){const t=(ar:string,eng:string)=>en?eng:ar;
 const rows=[
  [t('أعمار مستحقات الموردين','Supplier payable aging')],
  [t('الكيان المحاسبي','Accounting entity'),data.entity.code,data.entity.name],
  [t('حتى تاريخ','As of'),data.as_of,t('العملة','Currency'),'EGP'],
  [t('المورد','Supplier'),data.vendor?.code||'',data.vendor?.name||t('كل الموردين','All suppliers')],
  [t('المستحق للموردين','Payable to suppliers'),m(data.due_minor),t('مستحق من الموردين','Receivable from suppliers'),m(data.receivable_minor)],
  [t('الصافي','Net'),m(data.net_minor),t('رصيد دفتر الأستاذ','General ledger balance'),m(data.ledger_minor)],
  [t('فرق غير موزع على الفواتير','Unallocated ledger difference'),m(data.unallocated_minor)],
  [t('التصنيف حسب تاريخ الاستحقاق. المستحق من المورد يُعرض منفصلًا.','Aging uses invoice due dates. Supplier receivables are shown separately.')],
  [t('غير متأخر','Not overdue'),m(data.buckets.current),t('1–30 يومًا','1–30 days'),m(data.buckets.days_1_30),t('31–60 يومًا','31–60 days'),m(data.buckets.days_31_60),t('61–90 يومًا','61–90 days'),m(data.buckets.days_61_90),t('أكثر من 90 يومًا','Over 90 days'),m(data.buckets.days_91_plus)],
  [t('كود المورد','Supplier code'),t('المورد','Supplier'),t('الفاتورة','Invoice'),t('تاريخ الفاتورة','Invoice date'),t('تاريخ الاستحقاق','Due date'),t('أيام التأخير','Days overdue'),t('فئة العمر','Aging bucket'),t('قيمة الفاتورة','Invoice amount'),t('الخصم','Credit'),t('المدفوع','Paid'),t('المسترد','Refund received'),t('مستحق للمورد','Payable'),t('مستحق من المورد','Receivable'),t('الرصيد','Balance'),t('معرف الفاتورة','Invoice ID')],
  ...data.rows.map(r=>[r.vendor_code,r.vendor_name,r.invoice_number,r.invoice_date,r.due_date,BigInt(r.receivable_minor)>BigInt(0)?'':String(r.days_overdue),BigInt(r.receivable_minor)>BigInt(0)?t('مستحق من المورد','Supplier receivable'):agingBucketLabel(r.bucket,en),m(r.total_minor),m(r.credited_minor),m(r.paid_minor),m(r.refunded_minor),m(r.due_minor),m(r.receivable_minor),m(r.balance_minor),r.bill_id])
 ];return literalXlsx(rows,en?'Supplier aging':'أعمار الموردين',en,10,[18,36,30,16,16,16,26,24,24,24,24,24,24,24,40]);
}
