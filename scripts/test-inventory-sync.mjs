import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import {syncInventory} from '../.sites-runtime/tests/inventory-sync.mjs';
import {saveUnit} from '../.sites-runtime/tests/inventory.mjs';
const url=process.env.BUNYRA_TEST_DATABASE_URL;
if(!url||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('Isolated test database required');
const raw=neon(url),checks=[];
const owners=await raw`SELECT user_id FROM platform_owner`;
if(owners.some(o=>o.user_id!=='identity-test-platform-owner'))throw Error('Real owner: refusing fixtures');
const company=crypto.randomUUID(),project=crypto.randomUUID(),file=crypto.randomUUID();
const actor={userId:'sync-'+company,email:'sync@example.com'},sales={userId:'sales-'+company,email:'sales@example.com'};
await raw`INSERT INTO companies(id,name) VALUES(${company},'Excel sync tests')`;
await raw`INSERT INTO projects(id,company_id,name) VALUES(${project},${company},'Sync project')`;
await raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${actor.userId},${actor.email},'company_admin'),(${company},${sales.userId},${sales.email},'sales')`;
const row={code:'C/GR/SH/16B',building:'C',floor:'GR',category:'Shop',area:'38',proposed_price:'1000.25',status:'Available',phase:'Phase 1',out_area:'7'};
const input=rows=>({company_id:company,project_id:project,source_name:'sync.xlsx',rows});
const run=(i,commit=false)=>syncInventory(tenantSql(raw),actor,i,commit);
async function check(name,fn){await fn();checks.push({name,passed:true});console.log('PASS '+name);}
let initial,unit,preview;
await check('preview does not add units and commit requires a preview snapshot',async()=>{
 initial=await run(input([row,{...row,code:'RES',status:'Reservation'}]));assert.deepEqual(initial.summary,{created:2,updated:0,unchanged:0});
 assert.equal((await raw`SELECT count(*)::int n FROM inventory_units WHERE company_id=${company}`)[0].n,0);
 await assert.rejects(()=>run(input([row]),true),e=>e.code==='IMPORT_CONFLICT');
});
await check('one commit creates complete opening inventory and can be retried',async()=>{
 const body={...input([row,{...row,code:'RES',status:'Reservation'}]),expected:initial.expected};
 const result=await run(body,true);assert.ok(result.import_id);assert.equal((await run(body,true)).already_imported,true);
 unit=(await raw`SELECT * FROM inventory_units WHERE company_id=${company} AND code=${row.code}`)[0];
});
await raw`INSERT INTO project_plan_files(id,company_id,project_id,title,building,floor,kind,original_name,object_key,byte_size,sha256,version,status,created_by) VALUES(${file},${company},${project},'Sync plan','C','GR','pdf','sync.pdf',${company+'/sync.pdf'},100,'test',1,'ready',${actor.userId})`;
await raw`INSERT INTO plan_layouts(file_id,company_id,project_id,published,updated_by) VALUES(${file},${company},${project},true,${actor.userId})`;
await raw`INSERT INTO plan_unit_shapes(company_id,project_id,file_id,unit_id,page,points) VALUES(${company},${project},${file},${unit.id},1,'[[0.1,0.1],[0.3,0.1],[0.3,0.4]]'::jsonb)`;
await check('unmapped optional fields and reserved states remain unchanged',async()=>{
 const p=await run(input([{code:'RES',building:'C',floor:'GR',category:'Shop',area:'38',proposed_price:'1000.25'}]));
 assert.equal(p.ok,true);assert.equal(p.summary.unchanged,1);
});
await check('area changes retain unit identity, plan boundaries and optional fields',async()=>{
 const body=input([{code:row.code,building:'C',floor:'GR',category:'Shop',area:'42',proposed_price:'1000.25'}]);
 preview=await run(body);assert.equal(preview.summary.updated,1);assert.ok(preview.changes[0].fields.includes('area'));
 await run({...body,expected:preview.expected},true);
 const updated=(await raw`SELECT * FROM inventory_units WHERE id=${unit.id}`)[0];assert.equal(Number(updated.area),42);assert.equal(updated.details.phase,'Phase 1');assert.equal(updated.details.out_area,'7');
 const shapes=await raw`SELECT unit_id,points FROM plan_unit_shapes WHERE file_id=${file}`;assert.equal(shapes[0].unit_id,unit.id);assert.equal(shapes[0].points[0][0],0.1);
 const log=(await raw`SELECT before_data,after_data FROM audit_logs WHERE company_id=${company} AND action='inventory.updated' ORDER BY id DESC LIMIT 1`)[0];assert.equal(log.before_data.area,38);assert.equal(log.after_data.area,42);assert.equal(log.after_data.id,unit.id);
 assert.equal((await run({...body,expected:preview.expected},true)).already_imported,true);
});
await check('unchanged rows do not increment versions or overwrite current details',async()=>{
 const p=await run(input([{...row,area:'42'}]));assert.equal(p.summary.unchanged,1);
 const before=(await raw`SELECT version FROM inventory_units WHERE id=${unit.id}`)[0].version;
 await run({...input([{...row,area:'42'}]),expected:p.expected},true);
 assert.equal((await raw`SELECT version FROM inventory_units WHERE id=${unit.id}`)[0].version,before);
});
await check('stale previews reject the entire batch including valid new rows',async()=>{
 const body=input([{...row,area:'44'},{...row,code:'NEW'}]);const p=await run(body);
 const current=(await raw`SELECT version FROM inventory_units WHERE id=${unit.id}`)[0];
 await saveUnit(tenantSql(raw),actor,{...row,area:'43',status:'available',active:true,company_id:company,project_id:project,id:unit.id,version:current.version});
 await assert.rejects(()=>run({...body,expected:p.expected},true),e=>e.code==='IMPORT_CONFLICT');
 assert.equal((await raw`SELECT count(*)::int n FROM inventory_units WHERE company_id=${company} AND code='NEW'`)[0].n,0);
});
await check('reserved edits and creating reservation states through an existing unit are blocked',async()=>{
 assert.equal((await run(input([{...row,code:'RES',area:'99'}]))).errors[0].code,'UNIT_COMMITTED');
 assert.equal((await run(input([{...row,area:'43',status:'Sold'}]))).errors[0].code,'UNIT_COMMITTED');
});
await check('duplicate workbook codes do not produce partial writes',async()=>{const p=await run(input([{...row,code:'DUP'},{...row,code:'dup'}]));assert.equal(p.ok,false);assert.ok(p.errors.some(e=>e.code==='DUPLICATE_CODE'));});
await check('sales and cross-company actors cannot sync inventory',async()=>{
 await assert.rejects(()=>syncInventory(tenantSql(raw),sales,input([row])),e=>e.code==='FORBIDDEN');
 await assert.rejects(()=>run({...input([row]),company_id:crypto.randomUUID()}),e=>e.code==='INVALID_PROJECT'||e.code==='FORBIDDEN');
});
await check('concurrent commits create one receipt and one version change',async()=>{
 const body=input([{...row,area:'45'}]),p=await run(body);
 const results=await Promise.all([run({...body,expected:p.expected},true),run({...body,expected:p.expected},true)]);
 assert.equal(results[0].import_id,results[1].import_id);assert.equal((await raw`SELECT version FROM inventory_units WHERE id=${unit.id}`)[0].version,p.expected[0].version+1);
});
console.log(JSON.stringify({suite:'inventory-sync',passed:checks.length,checks}));
