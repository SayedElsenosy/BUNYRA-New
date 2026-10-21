import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const directory='.sites-runtime/navigation-tests';
fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(directory+'/report-csv.mjs',ts.transpileModule(fs.readFileSync('lib/bunyra/report-csv.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
const {csvCell,csvDocument,majorMinor,salesReportCsv,dealsReportCsv}=await import('../'+directory+'/report-csv.mjs');
const checks=[],test=(title,fn)=>{fn();checks.push(title);};
test('Arabic, commas, quotes and embedded newlines roundtrip as quoted CSV fields',()=>{
 assert.equal(csvCell('مبيعات "القاهرة", شركة\nثانية'),'"مبيعات ""القاهرة"", شركة\nثانية"');
 assert.ok(csvDocument(['Header'],[['قيمة']]).startsWith('\uFEFF"Header"\r\n'));
});
test('Never let user-provided spreadsheet formula strings execute',()=>{
 for(const malicious of ['=1+1','+1+1','-1+1','@sum(A1:A3)','\t=HYPERLINK("x")',' \r=1']){
  const value=csvCell(malicious);
  assert.ok(value.startsWith('"\''),JSON.stringify({malicious,value}));
 }
 assert.equal(csvCell('Valid Team'),'"Valid Team"');
});
test('Exact pennies and large values are not rounded by JS floats',()=>{
 assert.equal(majorMinor('100001'),'1000.01');
 assert.equal(majorMinor('20000'),'200.00');
 assert.equal(majorMinor('80001'),'800.01');
 assert.equal(majorMinor('9007199254740993'),'90071992547409.93');
 assert.equal(majorMinor('-1'),'-0.01');
});
test('Never include commission columns for a user lacking permission',()=>{
 const row={period:'2026-10-21',salesperson:'Sales User',currency:'EGP',calls:1,followups:0,completed_followups:0,bookings:1,sales:1,contract_value_minor:'100001',calculated_minor:'9999',earned_minor:'9999',paid_minor:'9999',recovered_minor:'0'};
 const hidden=salesReportCsv([row],false);
 assert.ok(!hidden.includes('Calculated commissions')&&!hidden.includes('9999'));
 const visible=salesReportCsv([row],true);
 assert.ok(visible.includes('Calculated commissions')&&visible.includes('99.99'));
});
test('Empty result exports only headers and no invented data',()=>{
 const csv=dealsReportCsv({money:[],projects:[],trend:[]},'summary');
 assert.equal(csv.split('\r\n').length,2);
});
test('Finance export maintains currency columns and cohort amounts',()=>{
 const csv=dealsReportCsv({money:[],trend:[],projects:[{project_id:'id',project_name:'=unexpected',currency:'EGP',contracts:1,contract_value_minor:'100001',collected_minor:'20000',outstanding_minor:'80001'}]},'projects');
 assert.ok(csv.includes('EGP')&&csv.includes('1000.01')&&csv.includes('800.01'));
 assert.ok(csv.includes('"\'=unexpected"'));
});
test('Column count mismatch prevents invalid CSV',()=>assert.throws(()=>csvDocument(['one','two'],[['alone']]),/CSV_COLUMN_MISMATCH/));
console.log(JSON.stringify({passed:checks.length,checks},null,2));
