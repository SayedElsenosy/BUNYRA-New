/** Server-side CSV for exports: UTF-8 BOM, RFC4180 escaping, Excel formula protection.
 * No formulas, negative values, or user strings are trusted as spreadsheet code. */
const dangerous=/^[\s\uFEFF]*[=+\-@]/u;
export function csvCell(value:unknown):string{
 let text=value===null||value===undefined?'':String(value);
 // Prefix the potentially executable cell, then escape quotes/newlines per CSV.
 if(dangerous.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
export function csvDocument(headers:string[],rows:unknown[][]):string{
 if(headers.length===0||headers.some(h=>!h.trim()))throw new Error('CSV_INVALID_HEADER');
 if(rows.some(r=>r.length!==headers.length))throw new Error('CSV_COLUMN_MISMATCH');
 return '\uFEFF'+[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
/** Decimal formatting stays exact even for aggregated PostgreSQL numeric sums. */
export function majorMinor(value:string|number|bigint):string{
 const n=BigInt(value);
 const sign=n<BigInt(0)?'-':'';
 const abs=n<BigInt(0)?-n:n;
 return sign+(abs/BigInt(100)).toString()+'.'+(abs%BigInt(100)).toString().padStart(2,'0');
}

type SalesRow={period:string;salesperson:string;currency:string;calls:number;followups:number;completed_followups:number;bookings:number;sales:number;contract_value_minor:string;calculated_minor:string;earned_minor:string;paid_minor:string;recovered_minor:string};
export function salesReportCsv(rows:SalesRow[],showCommissions:boolean):string{
 const base=['Period','Representative','Currency','Calls','Scheduled follow-ups','Completed follow-ups','Bookings','Contracts','Contract value'];
 const commissions=['Calculated commissions','Currently earned','Commission payments during period','Commission recoveries during period'];
 return csvDocument(showCommissions?[...base,...commissions]:base,rows.map(row=>{
  const value=[row.period,row.salesperson,row.currency,row.calls,row.followups,row.completed_followups,row.bookings,row.sales,row.currency==='—'?'':majorMinor(row.contract_value_minor)];
  return showCommissions?[...value,...(['calculated_minor','earned_minor','paid_minor','recovered_minor'] as const).map(k=>row.currency==='—'?'':majorMinor(row[k]))]:value;
 }));
}
type Money={currency:string;contracts:number;contract_value_minor:string;collected_minor:string;outstanding_minor:string;excess_minor:string};
type Timeline={period:string;currency:string;contracts:number;contract_value_minor:string;collected_minor:string;outstanding_minor:string};
type Project={project_id:string;project_name:string;currency:string;contracts:number;contract_value_minor:string;collected_minor:string;outstanding_minor:string};
type Deals={money:Money[];trend:Timeline[];projects:Project[]};
export type DealsExportKind='summary'|'projects'|'timeline';
export function dealsReportCsv(data:Deals,kind:DealsExportKind):string{
 if(kind==='summary')return csvDocument(['Currency','Contracts','Contract value','Net collected to date','Outstanding','Excess receipts'],data.money.map(m=>[m.currency,m.contracts,majorMinor(m.contract_value_minor),majorMinor(m.collected_minor),majorMinor(m.outstanding_minor),majorMinor(m.excess_minor)]));
 if(kind==='projects')return csvDocument(['Project','Currency','Contracts','Contract value','Net collected to date','Outstanding'],data.projects.map(p=>[p.project_name,p.currency,p.contracts,majorMinor(p.contract_value_minor),majorMinor(p.collected_minor),majorMinor(p.outstanding_minor)]));
 if(kind==='timeline')return csvDocument(['Signing period','Currency','Contracts','Contract value','Net collected to date','Outstanding'],data.trend.map(p=>[p.period,p.currency,p.contracts,majorMinor(p.contract_value_minor),majorMinor(p.collected_minor),majorMinor(p.outstanding_minor)]));
 throw new Error('INVALID_EXPORT_KIND');
}
