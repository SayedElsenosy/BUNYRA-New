import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Execute the real upload/download services without accessing a database or bucket.
const dir='.sites-runtime/document-revisions';
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/service.mjs',`import {z} from 'zod';
export const uuid=z.string().uuid();
export class ServiceError extends Error {constructor(code,status=400){super(code);this.code=code;this.status=status}}
export async function access(){throw Error('Unexpected access call')}`);
fs.writeFileSync(dir+'/record-scope.mjs',`import {ServiceError} from './service.mjs';
export async function requireBooking(sql,actor,company,booking,action){
 sql.permissions.push(action);
 if(company!==sql.company||booking!==sql.booking.id||!sql.allowed.has(action))throw new ServiceError('FORBIDDEN',403);
 return {...sql.booking};
}
export async function requireContract(){throw Error('Unexpected contract call')}`);
fs.writeFileSync(dir+'/projects.mjs',`export function minorUnits(){throw Error('Unexpected amount call')}`);
fs.writeFileSync(dir+'/notifications.mjs',`export async function queueAdjustmentNotification(){throw Error('Unexpected notification call')}`);
let source=ts.transpileModule(fs.readFileSync('lib/bunyra/finance-adjustments.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}
}).outputText;
for(const name of ['service','record-scope','projects','notifications'])source=source.replaceAll(`from './${name}'`,`from './${name}.mjs'`);
fs.writeFileSync(dir+'/finance-adjustments.mjs',source);
const {uploadBookingDocument,downloadBookingDocument}=await import('../'+dir+'/finance-adjustments.mjs');
const company='11111111-1111-4111-8111-111111111111',booking='22222222-2222-4222-8222-222222222222';
const actor={userId:'seller',email:'seller@example.test'};
const file=(text)=>new File([text],'identity.png',{type:'image/png'});
const checks=[];
async function check(name,fn){await fn();checks.push(name)}
function fixture(status='submitted',approve=false){
 const documents=[],objects=new Map(),removed=[],permissions=[],audits=[];
 const sql=(parts,...values)=>{
  const query=parts.join('?');
  return {then(resolve,reject){
   return Promise.resolve().then(()=>{
    if(query.startsWith('SELECT id FROM bookings'))return [{id:booking}];
    if(query.includes('bunyra_pricing_assert')){
     if(sql.changed)throw Object.assign(new Error('DOCUMENT_BOOKING_CHANGED'),{code:'P0001'});
     return [{}];
    }
    if(query.startsWith('UPDATE booking_documents')){
     for(const d of documents)if(d.company_id===values[0]&&d.booking_id===values[1]&&d.kind===values[2]&&d.status==='ready')d.status='superseded';
     return [];
    }
    if(query.startsWith('INSERT INTO booking_documents')){
     if(sql.failInsert)throw new Error('Simulated database failure');
     const [id,company_id,booking_id,kind,original_name,mime_type,file_size,sha256,object_key,created_by]=values;
     documents.push({id,company_id,booking_id,kind,original_name,mime_type,file_size,sha256,object_key,created_by,status:'ready'});return [];
    }
    if(query.startsWith('UPDATE bookings')){sql.booking.id_document_key=values[0];return [];}
    if(query.startsWith('INSERT INTO audit_logs')){audits.push(values);return [];}
    if(query.startsWith('SELECT original_name'))return documents.filter(d=>d.company_id===values[0]&&d.booking_id===values[1]&&d.id===values[2]&&['ready','superseded'].includes(d.status));
    throw Error('Unexpected SQL: '+query);
   }).then(resolve,reject);
  }};
 };
 Object.assign(sql,{company,booking:{id:booking,status},allowed:new Set(['bookings.create','bookings.read',...(approve?['bookings.approve']:[])]),permissions});
 sql.transaction=async(queries)=>{
  const snapshot=structuredClone(documents),key=sql.booking.id_document_key;
  try{const rows=[];for(const q of queries)rows.push(await q);return rows;}
  catch(error){documents.splice(0,documents.length,...snapshot);sql.booking.id_document_key=key;throw error;}
 };
 const storage={async put(key,bytes){objects.set(key,bytes)},async get(key){return objects.get(key)},async remove(key){removed.push(key);objects.delete(key)}};
 return {sql,storage,documents,objects,removed,permissions,audits};
}
await check('initial salesperson upload remains allowed while submitted',async()=>{
 const f=fixture();await uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('first'),f.storage);
 assert.equal(f.documents.length,1);assert.equal(f.documents[0].status,'ready');assert.equal(f.removed.length,0);
 assert.deepEqual(f.permissions,['bookings.create']);
});
await check('replacement preserves the original row and bytes with only one current revision',async()=>{
 const f=fixture();const first=await uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('first'),f.storage);
 const second=await uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('second'),f.storage);
 assert.equal(f.documents.length,2);assert.deepEqual(f.documents.map(d=>d.status),['superseded','ready']);
 assert.equal(f.documents[0].id,first.id);assert.equal(f.documents[1].id,second.id);
 assert.equal(f.objects.size,2);assert.equal(f.removed.length,0);assert.equal(f.sql.booking.id_document_key,f.documents[1].object_key);
});
await check('historical revision downloads through the same record scope and integrity check',async()=>{
 const f=fixture();const first=await uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('first'),f.storage);
 await uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('second'),f.storage);
 const original=await downloadBookingDocument(f.sql,actor,company,booking,first.id,f.storage);
 assert.equal(new TextDecoder().decode(original.bytes),'first');assert.equal(f.permissions.at(-1),'bookings.read');
 f.objects.set(f.documents[0].object_key,new TextEncoder().encode('altered'));
 await assert.rejects(downloadBookingDocument(f.sql,actor,company,booking,first.id,f.storage),e=>e.code==='FILE_INTEGRITY');
});
await check('a salesperson cannot replace or add approved evidence without approval authority',async()=>{
 for(const status of ['approved','accounts_pending','accounts_confirmed']){
  const f=fixture(status);await assert.rejects(uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('new'),f.storage),e=>e.code==='FORBIDDEN');
  assert.equal(f.objects.size,0);assert.equal(f.documents.length,0);
 }
});
await check('an authorized reviewer can add evidence after approval without losing originals',async()=>{
 const f=fixture('submitted',true);await uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('first'),f.storage);
 f.sql.booking.status='approved';await uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('second'),f.storage);
 assert.equal(f.documents.length,2);assert.equal(f.objects.size,2);assert.ok(f.permissions.includes('bookings.approve'));
});
await check('database failure rolls back the revision pointer and removes only the unsuccessful new object',async()=>{
 const f=fixture();await uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('first'),f.storage);
 const key=f.documents[0].object_key;f.sql.failInsert=true;
 await assert.rejects(uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('second'),f.storage),/Simulated database failure/);
 assert.equal(f.documents.length,1);assert.equal(f.documents[0].status,'ready');assert.equal(f.objects.size,1);
 assert.ok(f.objects.has(key));assert.equal(f.removed.length,1);assert.notEqual(f.removed[0],key);
});
await check('approval racing the upload rejects the stale authorization and cleans its new object',async()=>{
 const f=fixture();f.sql.changed=true;
 await assert.rejects(uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('first'),f.storage),/DOCUMENT_BOOKING_CHANGED/);
 assert.equal(f.documents.length,0);assert.equal(f.objects.size,0);assert.equal(f.removed.length,1);
});
await check('rejected bookings and foreign records cannot upload or download evidence',async()=>{
 const f=fixture('rejected');await assert.rejects(uploadBookingDocument(f.sql,actor,company,booking,'id_card',file('first'),f.storage),e=>e.code==='INVALID_STATUS');
 await assert.rejects(downloadBookingDocument(f.sql,actor,company,'foreign',crypto.randomUUID(),f.storage),e=>e.code==='FORBIDDEN');
 assert.equal(f.objects.size,0);
});
console.log(JSON.stringify({passed:checks.length,checks},null,2));
