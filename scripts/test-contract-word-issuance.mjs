import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import PizZip from 'pizzip';
import {createHash} from 'node:crypto';

const dir='.sites-runtime/contract-word-security';
fs.mkdirSync(dir,{recursive:true});
const options={module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022};
let source=ts.transpileModule(fs.readFileSync('lib/bunyra/word-templates.ts','utf8'),{compilerOptions:options}).outputText;
source=source.replace('import "server-only";','');
for(const name of ['service','record-scope','storage','pricing-calculator'])source=source.replaceAll(`from "./${name}"`,`from "./${name}.mjs"`);
fs.writeFileSync(dir+'/word-templates.mjs',source);
fs.writeFileSync(dir+'/service.mjs',`import {z} from 'zod';export const uuid=z.string().uuid();export class ServiceError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}export async function access(){return {};}`);
fs.writeFileSync(dir+'/record-scope.mjs',`import {ServiceError} from './service.mjs';export async function requireContract(sql){sql.authChecks++;if(!sql.allowed)throw new ServiceError('FORBIDDEN',403);return {id:'contract'};}`);
fs.writeFileSync(dir+'/storage.mjs',`export function planStorage(){throw Error('Explicit test storage required');}`);
// Keep real amount formatting; isolate its unrelated plan calculation dependency.
const pricing=ts.transpileModule(fs.readFileSync('lib/bunyra/pricing-calculator.ts','utf8'),{compilerOptions:options}).outputText.replace("from './projects'","from './projects.mjs'");
fs.writeFileSync(dir+'/pricing-calculator.mjs',pricing);
fs.writeFileSync(dir+'/projects.mjs','export function calculatePlan(){throw Error("unused")} export function minorUnits(){throw Error("unused")}');
const {downloadContractWord,sampleContractWord}=await import('../'+dir+'/word-templates.mjs');
const company='11111111-1111-4111-8111-111111111111',contract='22222222-2222-4222-8222-222222222222';
const actor={userId:'seller',email:'seller@example.test'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const template=sampleContractWord();
const frozen={contract_number:'ORIGINAL-1',signed_date:'2026-10-27',status:'active',value_final_minor:'100000',currency:'USD',customer_name:'Original Buyer',customer_phone:'01000000000',customer_email:'original@example.test',correspondence_address:'Original Address',national_id:'12345678901234',unit_code:'A-1',unit_area:'99',project_name:'Original Project',installments:[{number:1,due_date:'2026-11-27',amount_minor:'100000',paid_minor:'0',status:'due'}]};
function fixture(){
 const objects=new Map([['original-template',template]]),removed=[],calls=[];
 let file;let snapshot={template_object_key:'original-template',template_sha256:hash(template),template_file_size:template.length,data_snapshot:structuredClone(frozen)};
 const sql=(strings,...values)=>{
  const text=strings.join('?');calls.push({text,values});
  if(text.includes('SELECT object_key,sha256,file_size,original_name FROM contract_word_files'))return Promise.resolve(file?[file]:[]);
  if(text.includes('FROM contract_word_snapshots'))return Promise.resolve(snapshot?[snapshot]:[]);
  if(text.includes('INSERT INTO contract_word_files')){
   if(!file)file={object_key:values[2],sha256:values[3],file_size:values[4],original_name:values[5]};
   return Promise.resolve([]);
  }
  if(text.includes('INSERT INTO audit_logs'))return Promise.resolve([]);
  throw Error('Unexpected live-data query: '+text);
 };
 sql.allowed=true;sql.authChecks=0;sql.transaction=queries=>Promise.all(queries);
 const storage={get:async key=>{assert.ok(objects.has(key));return objects.get(key)},put:async(key,bytes)=>{assert.ok(!objects.has(key));objects.set(key,bytes)},remove:async key=>{removed.push(key);objects.delete(key)}};
 return {sql,storage,objects,removed,calls,get file(){return file},set file(v){file=v},get snapshot(){return snapshot},set snapshot(v){snapshot=v}};
}
const checks=[];async function check(name,fn){await fn();checks.push(name)}
await check('first issuance renders only the signing snapshot and persists exact bytes',async()=>{
 const f=fixture(),r=await downloadContractWord(f.sql,actor,company,contract,false,f.storage);
 const xml=new PizZip(r.bytes).file('word/document.xml').asText();
 assert.match(xml,/Original Buyer/);assert.match(xml,/Original Project/);assert.match(xml,/1000.00 USD/);
 assert.match(xml,/12345678901234/);assert.equal(f.file.sha256,hash(r.bytes));assert.equal(f.sql.authChecks,1);
});
await check('repeat download returns persisted original even after current template and customer changes',async()=>{
 const f=fixture(),first=await downloadContractWord(f.sql,actor,company,contract,false,f.storage);
 f.snapshot.data_snapshot.customer_name='Changed Buyer';f.snapshot.template_object_key='different-template';
 const second=await downloadContractWord(f.sql,actor,company,contract,false,f.storage);
 assert.deepEqual(first.bytes,second.bytes);assert.equal(f.objects.size,2);assert.equal(f.sql.authChecks,2);
});
await check('existing contracts cannot fabricate a historical snapshot on first download',async()=>{
 const f=fixture();f.snapshot=null;
 await assert.rejects(()=>downloadContractWord(f.sql,actor,company,contract,false,f.storage),e=>e.code==='CONTRACT_WORD_SNAPSHOT_REQUIRED');
 assert.equal(f.objects.size,1);assert.equal(f.file,undefined);
});
await check('missing template at signing cannot silently adopt a later template',async()=>{
 const f=fixture();f.snapshot.template_object_key=null;
 await assert.rejects(()=>downloadContractWord(f.sql,actor,company,contract,false,f.storage),e=>e.code==='TEMPLATE_NOT_CONFIGURED_AT_SIGNING');
 assert.equal(f.objects.size,1);
});
await check('an incomplete signing schedule never adopts later installments',async()=>{
 const f=fixture();f.snapshot.data_snapshot.installments=[];
 await assert.rejects(()=>downloadContractWord(f.sql,actor,company,contract,false,f.storage),e=>e.code==='CONTRACT_WORD_SNAPSHOT_INVALID');
 assert.equal(f.objects.size,1);
});
await check('authorization still runs before returning an already issued file',async()=>{
 const f=fixture();await downloadContractWord(f.sql,actor,company,contract,false,f.storage);f.sql.allowed=false;
 await assert.rejects(()=>downloadContractWord(f.sql,actor,company,contract,false,f.storage),e=>e.code==='FORBIDDEN');
});
await check('tampered stored output is rejected instead of regenerated from mutable data',async()=>{
 const f=fixture();await downloadContractWord(f.sql,actor,company,contract,false,f.storage);
 f.objects.set(f.file.object_key,new Uint8Array([1,2,3]));
 await assert.rejects(()=>downloadContractWord(f.sql,actor,company,contract,false,f.storage),e=>e.code==='FILE_INTEGRITY');
});
await check('tampered original template is rejected before any issuance writes',async()=>{
 const f=fixture();f.objects.set('original-template',new Uint8Array([1,2,3]));
 await assert.rejects(()=>downloadContractWord(f.sql,actor,company,contract,false,f.storage),e=>e.code==='FILE_INTEGRITY');
 assert.equal(f.file,undefined);
});
await check('concurrent first downloads converge on one immutable object without overwrites',async()=>{
 const f=fixture();
 const [a,b]=await Promise.all([downloadContractWord(f.sql,actor,company,contract,false,f.storage),downloadContractWord(f.sql,actor,company,contract,false,f.storage)]);
 assert.deepEqual(a.bytes,b.bytes);assert.equal(f.objects.size,2);assert.equal(f.removed.length,1);
 assert.notEqual(f.removed[0],f.file.object_key);
});
console.log(JSON.stringify({passed:checks.length,checks,scope:'Exact service behavior with SQL/storage doubles; migration requires isolated PostgreSQL validation.'},null,2));
