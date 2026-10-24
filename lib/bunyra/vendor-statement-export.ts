import {zipSync,strToU8} from 'fflate';
import type {VendorStatement} from './vendor-statement';
import {statementAmount,statementEvent} from './vendor-statement-format';
const xml=(s:string)=>s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
/** All cells are literal inline text, preserving exact monetary digits and preventing formulas. */
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
 const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="${en?'0':'1'}"><pane ySplit="9" topLeftCell="A10" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${[14,28,35,60,22,22,24,40,40].map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" s="${i===8?'1':i===0?'2':'0'}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData><autoFilter ref="A9:I${rows.length}"/></worksheet>`;
 return zipSync(Object.fromEntries(Object.entries({
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${en?'Supplier statement':'كشف المورد'}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF10243B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml':sheet
 }).map(([k,v])=>[k,strToU8(v)])));
}
