import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const output='.sites-runtime/navigation-tests';
fs.mkdirSync(output,{recursive:true});
const source=fs.readFileSync('lib/bunyra/report-dates.ts','utf8');
fs.writeFileSync(path.join(output,'report-dates.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
const {reportWindow}=await import('../'+output+'/report-dates.mjs');
const checks=[];
const test=(name,fn)=>{fn();checks.push(name)};
const utc=(iso)=>new Date(iso);
test('Egypt local day differs from UTC at midnight',()=>{
 assert.deepEqual(reportWindow('today','Africa/Cairo',utc('2026-10-20T22:30:00Z')),{from:'2026-10-21',to:'2026-10-21'});
});
test('New York local day is not server UTC day',()=>{
 assert.deepEqual(reportWindow('today','America/New_York',utc('2026-10-21T02:00:00Z')),{from:'2026-10-20',to:'2026-10-20'});
});
test('week begins Monday and ends on current local day',()=>{
 assert.deepEqual(reportWindow('week','Africa/Cairo',utc('2026-10-21T12:00:00Z')),{from:'2026-10-19',to:'2026-10-21'});
 assert.deepEqual(reportWindow('week','UTC',utc('2026-10-25T12:00:00Z')),{from:'2026-10-19',to:'2026-10-25'});
});
test('month begins the first calendar day in company time zone',()=>{
 assert.deepEqual(reportWindow('month','UTC',utc('2026-03-17T18:00:00Z')),{from:'2026-03-01',to:'2026-03-17'});
});
test('last 30 calendar days includes today across leap year',()=>{
 assert.deepEqual(reportWindow('30days','UTC',utc('2024-03-01T08:00:00Z')),{from:'2024-02-01',to:'2024-03-01'});
});
test('invalid preset cannot silently widen a financial report',()=>{
 assert.throws(()=>reportWindow('year','UTC',utc('2026-01-01T12:00:00Z')),/INVALID_REPORT_PRESET/);
});
console.log(JSON.stringify({passed:checks.length,checks},null,2));
