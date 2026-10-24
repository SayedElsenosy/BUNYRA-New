import type {CustomerStatement,CustomerAging} from './customer-accounts';
import {literalXlsx} from './literal-xlsx';
import {statementAmount as m} from './vendor-statement-format';
import {agingBucketLabel} from './vendor-aging-format';
export function customerStatementXlsx(d:CustomerStatement,en:boolean){
 const t=(ar:string,eng:string)=>en?eng:ar;
 const rows=[
  [t('كشف حساب العميل','Customer statement')],[d.customer.full_name],[d.entity.code,d.entity.name],[d.from,d.to,'EGP'],
  [t('رصيد أول المدة','Opening balance'),m(d.opening_minor)],[t('مدين','Debits'),m(d.debit_minor)],[t('دائن','Credits'),m(d.credit_minor)],
  [t('رصيد آخر المدة','Closing balance'),m(d.closing_minor)],[t('ذمم العملاء','Receivables'),m(d.receivable_minor)],[t('دفعات مقدمة','Customer advances'),m(d.advance_minor)],
  [t('الرصيد الموجب مستحق من العميل والسالب لصالحه. هذا كشف الأستاذ بالجنيه المصري.','Positive balances are due from the customer; negative balances are in their favor. EGP general ledger statement.')],
  [t('التاريخ','Date'),t('الحساب','Account'),t('نوع الحساب','Account role'),t('المرجع','Reference'),t('الوصف','Description'),t('مدين','Debit'),t('دائن','Credit'),t('الرصيد','Balance'),t('معرف القيد','Journal ID'),t('معرف المستند','Source ID')],
  ...d.rows.map(r=>[r.entry_date,r.account_code+' · '+r.account_name,r.account_role==='receivable'?t('ذمم العملاء','Receivables'):t('دفعات مقدمة','Advances'),r.reference,r.description,m(r.debit_minor),m(r.credit_minor),m(r.balance_minor),r.entry_id,r.source_id||''])
 ];return literalXlsx(rows,en?'Customer statement':'كشف العميل',en,12,[14,35,25,30,55,22,22,22,40,40]);
}
export function customerAgingXlsx(d:CustomerAging,en:boolean){
 const t=(ar:string,eng:string)=>en?eng:ar;
 const rows=[
  [t('أعمار مديونيات العملاء','Customer receivable aging')],[d.entity.code,d.entity.name],[d.customer?.full_name||t('جميع العملاء','All customers'),d.as_of,d.currency],
  [t('المتبقي بالأقساط','Installment balance'),m(d.due_minor)],[t('رصيد زائد لصالح العميل','Excess customer credit'),m(d.credit_minor)],
  [t('ذمم الأستاذ','Ledger receivables'),m(d.ledger_receivable_minor)],[t('دفعات مقدمة بالأستاذ','Ledger advances'),m(d.ledger_advance_minor)],
  [t('الفرق بين الجدول والأستاذ','Schedule minus ledger'),m(d.difference_minor)],[t('حركات تنتظر الترحيل','Pending posting events'),String(d.pending_events)],
  ...Object.entries(d.buckets).map(([b,v])=>[agingBucketLabel(b as keyof CustomerAging['buckets'],en),m(v)]),
  [t('جدول تعاقدي بعملة العقد؛ الفرق لا يعني تلقائيًا خطأ أو إيرادًا غير مثبت. لا تتم مقاصة الدفعات المقدمة مع الأقساط تلقائيًا.','Contract schedule in contract currency. The difference is not automatically an error or unrecognized revenue. Advances are not automatically offset against installments.')],
  [t('العميل','Customer'),t('العقد','Contract'),t('المشروع','Project'),t('الوحدة','Unit'),t('القسط','Installment'),t('الاستحقاق','Due date'),t('أيام التأخير','Days overdue'),t('الفئة','Bucket'),t('قيمة القسط','Amount'),t('التحصيلات','Collections'),t('التسويات','Settlements'),t('المردود والمعكوس','Refunds and reversals'),t('المتبقي','Due'),t('رصيد زائد','Excess credit'),t('معرف القسط','Installment ID')],
  ...d.rows.map(r=>[r.customer_name,r.contract_number,r.project_name,r.unit_code,String(r.number),r.due_date,r.due_minor==='0'?'':String(r.days_overdue),r.due_minor==='0'?t('رصيد لصالح العميل','Customer credit'):agingBucketLabel(r.bucket,en),m(r.amount_minor),m(r.collected_minor),m(r.settled_minor),m(r.returned_minor),m(r.due_minor),m(r.credit_minor),r.installment_id])
 ];return literalXlsx(rows,en?'Customer aging':'أعمار العملاء',en,16,[35,25,30,20,14,14,16,25,22,22,22,22,22,22,40]);
}
