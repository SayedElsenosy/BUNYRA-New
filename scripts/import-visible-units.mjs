// Operator-only local runner. Config lives outside the repo; no credentials or workbook data are logged.
import fs from 'node:fs';
import {neon} from '@neondatabase/serverless';
import {readSheet} from 'read-excel-file/node';
import {firstSheetVisibility} from '../.sites-runtime/tests/xlsx-visibility.mjs';
import {mapImportHeaders,mappedCell} from '../.sites-runtime/tests/import-format.mjs';
import {importInventory} from '../.sites-runtime/tests/imports.mjs';
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),source=process.argv[3],commit=process.argv[4]==='--commit-visible';
if(!c.actor||!c.company_id||!c.project_id)throw Error('Explicit actor and project required');
const data=await readSheet(source,{parseNumber:s=>s}),hidden=new Set(firstSheetVisibility(fs.readFileSync(source)).hiddenRows),mapping=mapImportHeaders(data[0]);
const visible=data.slice(1).map((row,i)=>({row,index:i+2})).filter(r=>!hidden.has(r.index));
const input={company_id:c.company_id,project_id:c.project_id,source_name:'Price List.xlsx',source_rows:visible.map(r=>r.index),rows:visible.map(r=>Object.fromEntries(Object.entries(mapping).map(([field,index])=>[field,mappedCell(r.row,index)])))};
const sql=neon(c.database_url),preview=await importInventory(sql,c.actor,input,false,true);
console.log(JSON.stringify({phase:'preview',visible:visible.length,hidden:hidden.size,ok:preview.ok,total:preview.total,errors:preview.errors?.length,rounded:preview.warnings?.length,already_imported:preview.already_imported}));
if(!preview.ok)throw Error('Preview contains errors');
if(commit){const r=await importInventory(sql,c.actor,input,true,true);if(!r.ok)throw Error('Import did not complete');console.log(JSON.stringify({phase:'committed',ok:r.ok,total:r.total,import_id:r.import_id,already_imported:r.already_imported}));}
