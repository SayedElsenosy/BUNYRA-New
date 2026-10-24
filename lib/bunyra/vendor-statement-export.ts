import type {VendorStatement} from './vendor-statement';
import {statementAmount,statementEvent} from './vendor-statement-format';
import {literalXlsx} from './literal-xlsx';
export function vendorStatementXlsx(data:VendorStatement,en:boolean){
 const t=(ar:string,eng:string)=>en?eng:ar,m=statementAmount;
 const rows=[
  [t('كشف حساب المورد','Supplier statement'),data.vendor.code,data.vendor.name],
  [t('الكيان المحاسبي','Accounting entity'),data.entity.code,data.entity.name],
  [t('من','From'),data.from,t('إلى','To'),data.to],
  [t('العملة','Currency'),'EGP'],
  [t('رصيد أول المدة','Opening balance'),m(data.opening_minor)],
  [t('إجمالي المدين','Total debits'),m(data.debit_minor),t('إجمالي الدائن','Total credits'),m(data.credit_minor)],
  [t('رصيد آخر المدة','Closing balance'),m(data.closing_minor)],
  [t('الرصيد الموجب مستحق للمورد والسالب مستحق من المورد','Positive balance is payable; negative balance is receivable from the supplier')],
  [t('التاريخ','Date'),t('نوع الحركة','Movement'),t('المرجع','Reference'),t('الوصف','Description'),t('مدين','Debit'),t('دائن','Credit'),t('الرصيد','Balance'),t('معرف القيد','Journal ID'),t('معرف المستند الأصلي','Source document ID')],
  ...data.rows.map(r=>[r.entry_date,statementEvent(r,en),r.reference,r.description,m(r.debit_minor),m(r.credit_minor),m(r.balance_minor),r.entry_id,r.source_id||''])
 ];
 return literalXlsx(rows,en?'Supplier statement':'كشف المورد',en,9,[14,28,35,60,22,22,24,40,40]);
}
