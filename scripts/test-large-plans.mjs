import assert from 'node:assert/strict';
import * as transfer from '../.sites-runtime/tests/plan-transfer.mjs';
import {mapImportHeaders,mappedCell,invalidCodeHeader} from '../.sites-runtime/tests/import-format.mjs';
import {validateImportRows,importInventory} from '../.sites-runtime/tests/imports.mjs';
import {saveUnit} from '../.sites-runtime/tests/inventory.mjs';
import {PLAN_CHUNK_BYTES,MAX_PLAN_BYTES} from '../.sites-runtime/tests/plan-limits.mjs';
export async function runLargePlanTests(sql,storage){
 const checks=[];async function check(name,fn){await fn();checks.push({name,passed:true});}
 const company=crypto.randomUUID(),project=crypto.randomUUID(),other=crypto.randomUUID(),tag=company.slice(0,8),actor={userId:'large-admin-'+tag,email:tag+'@example.com'},sales={userId:'large-sales-'+tag,email:'sales-'+tag+'@example.com'};
 await sql`INSERT INTO companies(id,name) VALUES(${company},'Large plan test')`;
 await sql`INSERT INTO projects(id,company_id,name) VALUES(${project},${company},'Large plans A'),(${other},${company},'Large plans B')`;
 await sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${actor.userId},${actor.email},'company_admin'),(${company},${sales.userId},${sales.email},'sales')`;
 await check('Price List headers map to actual unit number, never cancelled',()=>{const m=mapImportHeaders(['canclled','Unit Number','x','Building Name','Floor Number','Unit Type','Gross Area (sqm)','x','x','x','x','Availability Status','Total Price']);assert.equal(m.code,'1');assert.equal(m.status,'11');assert.equal(m.proposed_price,'12');assert.equal(m.area,'6');assert.equal(m.floor,'4');assert.equal(m.building,'3');assert.equal(m.category,'5');assert.equal(invalidCodeHeader('canclled'),true);assert.equal(mapImportHeaders(['cancelled']).code,'');});
 await check('unmapped optional column never uses the first workbook cell',()=>{assert.equal(mappedCell([false,'U1'],undefined),'');assert.equal(mappedCell([false,'U1'],''),'');assert.equal(mappedCell([false,'U1'],'1'),'U1');});
 const row={code:'OLD1',building:'B',floor:'1',category:'Office',area:'120',proposed_price:'1200000.25',status:'SOLD',active:''};
 await check('invalid workbook values include original value and row number',()=>{const r=validateImportRows(company,project,[{...row,code:false,status:'mystery'}]);assert.equal(r.errors.find(e=>e.field==='status').value,'mystery');assert.equal(r.errors[0].row,2);});
 await check('opening sold unit retains status/history and cannot be edited',async()=>{const r=await importInventory(sql,actor,{company_id:company,project_id:project,source_name:'opening.xlsx',rows:[row]},true);assert.equal(r.ok,true);const u=(await sql`SELECT id,status,version FROM inventory_units WHERE company_id=${company} AND code='OLD1'`)[0];assert.equal(u.status,'sold');await assert.rejects(()=>saveUnit(sql,actor,{...row,company_id:company,project_id:project,id:u.id,version:u.version,status:'available',active:true}));const h=await sql`SELECT next_status FROM unit_status_history WHERE company_id=${company} AND unit_id=${u.id}`;assert.equal(h[0].next_status,'sold');});
 const bytes=new Uint8Array(12*1024*1024+137);bytes.set(new TextEncoder().encode('AC1032 large isolated test drawing'));bytes[bytes.length-1]=71;
 const meta={company_id:company,project_id:project,title:'12 MiB test original',building:'B',floor:'1',original_name:'large.dwg',size:bytes.length,header:Array.from(bytes.slice(0,1024))};let id;
 await check('100 MiB advertised limit; bigger files rejected before storage',async()=>{assert.equal(MAX_PLAN_BYTES,104857600);await assert.rejects(()=>transfer.beginPlanTransfer(sql,actor,{...meta,size:MAX_PLAN_BYTES+1},storage));});
 await check('sales and wrong project cannot access upload sessions',async()=>{await assert.rejects(()=>transfer.beginPlanTransfer(sql,sales,meta,storage),e=>e.code==='FORBIDDEN');});
 await check('multipart begin reserves version and quota without publishing',async()=>{const r=await transfer.beginPlanTransfer(sql,actor,meta,storage);id=r.id;assert.equal(r.chunk_size,PLAN_CHUNK_BYTES);assert.equal((await sql`SELECT status FROM project_plan_files WHERE id=${id}`)[0].status,'uploading');});
 await check('wrong project session access denied',()=>assert.rejects(()=>transfer.putPlanPart(sql,actor,company,other,id,1,bytes.slice(0,PLAN_CHUNK_BYTES),storage),e=>e.code==='NOT_FOUND'));
 await check('wrong chunk length rejected',()=>assert.rejects(()=>transfer.putPlanPart(sql,actor,company,project,id,1,bytes.slice(0,12),storage),e=>e.code==='INVALID_FILE_SIZE'));
 await check('first chunk signature must match original type',async()=>{const bad=bytes.slice(0,PLAN_CHUNK_BYTES);bad.fill(0,0,8);await assert.rejects(()=>transfer.putPlanPart(sql,actor,company,project,id,1,bad,storage),e=>e.code==='UNSUPPORTED_FILE');});
 await check('incomplete transfer cannot be published',()=>assert.rejects(()=>transfer.completePlanTransfer(sql,actor,company,project,id,storage),e=>e.code==='UPLOAD_INCOMPLETE'));
 await check('12 MiB original uploads as three real private S3 parts',async()=>{for(let i=0;i<Math.ceil(bytes.length/PLAN_CHUNK_BYTES);i++)await transfer.putPlanPart(sql,actor,company,project,id,i+1,bytes.slice(i*PLAN_CHUNK_BYTES,(i+1)*PLAN_CHUNK_BYTES),storage);});
 await check('retrying the same part is safe',()=>transfer.putPlanPart(sql,actor,company,project,id,1,bytes.slice(0,PLAN_CHUNK_BYTES),storage));
 await check('complete verifies remote size and stores immutable ETag',async()=>{await transfer.completePlanTransfer(sql,actor,company,project,id,storage);const r=(await sql`SELECT status,object_etag FROM project_plan_files WHERE id=${id}`)[0];assert.equal(r.status,'ready');assert.ok(r.object_etag);});
 await check('completion retry does not duplicate version or audit',async()=>{await transfer.completePlanTransfer(sql,actor,company,project,id,storage);const a=await sql`SELECT id FROM audit_logs WHERE company_id=${company} AND action='project.plan_uploaded'`;assert.equal(a.length,1);});
 await check('range download returns exact original first bytes',async()=>{const r=await transfer.streamPlan(sql,actor,company,project,id,'bytes=0-31',storage);assert.equal(r.size,32);assert.equal(r.range,`bytes 0-31/${bytes.length}`);const actual=new Uint8Array(await new Response(r.body).arrayBuffer());assert.deepEqual(actual,bytes.slice(0,32));});
 await check('suffix download preserves final bytes',async()=>{const r=await transfer.streamPlan(sql,actor,company,project,id,'bytes=-8',storage);const actual=new Uint8Array(await new Response(r.body).arrayBuffer());assert.deepEqual(actual,bytes.slice(-8));});
 await check('malformed or out-of-bounds ranges rejected',()=>{for(const r of ['bytes=1-0','bytes=999999999-','bytes=-0','bytes=0-1,4-5'])assert.throws(()=>transfer.validRange(r,bytes.length),e=>e.code==='INVALID_RANGE');});
 await check('changed remote ETag fails before streaming',()=>assert.rejects(()=>transfer.streamPlan(sql,actor,company,project,id,undefined,{...storage,head:async()=>({size:bytes.length,etag:'wrong'})}),e=>e.code==='FILE_INTEGRITY'));
 await check('completed objects cannot be overwritten through part endpoint',()=>assert.rejects(()=>transfer.putPlanPart(sql,actor,company,project,id,1,bytes.slice(0,PLAN_CHUNK_BYTES),storage),e=>e.code==='UPLOAD_EXPIRED'));
 return {passed:checks.length,checks,fixture_company:company,uploaded_bytes:bytes.length};
}
