import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import assert from 'node:assert/strict';
import * as inv from '../.sites-runtime/tests/inventory.mjs';
export async function runInventoryTests(sql){
 const checks=[];async function check(name,fn){await fn();checks.push({name,passed:true});}
 const a=crypto.randomUUID(),b=crypto.randomUUID(),project=crypto.randomUUID(),other=crypto.randomUUID(),tag=a.slice(0,8);
 const admin={userId:'inv-admin-'+tag,email:'admin-'+tag+'@example.com'},sales={userId:'inv-sales-'+tag,email:'sales-'+tag+'@example.com'},ops={userId:'inv-ops-'+tag,email:'ops-'+tag+'@example.com'};
 await sql`INSERT INTO companies(id,name) VALUES(${a},'Inventory test A'),(${b},'Inventory test B')`;
 await sql`INSERT INTO projects(id,company_id,name) VALUES(${project},${a},'Inventory project'),(${other},${b},'Other inventory project')`;
 await sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${a},${admin.userId},${admin.email},'company_admin'),(${a},${sales.userId},${sales.email},'sales'),(${a},${ops.userId},${ops.email},'operations')`;
 const input={company_id:a,project_id:project,version:0,code:'U-1',building:'B1',floor:'F1',category:'Office',area:'120.50',proposed_price:'1500000.01',status:'available',active:true};let unit;
 const reject=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 await check('admin creates inventory unit with exact minor amount',async()=>{unit=await inv.saveUnit(tenantSql(sql),admin,input);const r=await inv.inventory(tenantSql(sql),admin,a,project,{});assert.equal(r.units[0].proposed_price_minor,'150000001');assert.equal(r.units[0].area,'120.50');});
 await check('duplicate codes rejected case insensitively within project',()=>assert.rejects(()=>inv.saveUnit(tenantSql(sql),admin,{...input,code:'u-1'})));
 await check('sales cannot create or change price',()=>reject(()=>inv.saveUnit(tenantSql(sql),sales,input),'FORBIDDEN'));
 await check('sales sees unit but not unapproved price',async()=>{const r=await inv.inventory(tenantSql(sql),sales,a,project,{});assert.equal(r.units.length,1);assert.equal(r.units[0].proposed_price_minor,null);assert.equal(r.can_write,false);});
 await check('cross-company read denied',()=>reject(()=>inv.inventory(tenantSql(sql),admin,b,other,{}),'FORBIDDEN'));
 await check('cross-company project write denied',()=>reject(()=>inv.saveUnit(tenantSql(sql),admin,{...input,project_id:other}),'INVALID_PROJECT'));
 await check('forged owner mode denied',()=>reject(()=>inv.inventory(tenantSql(sql),admin,b,other,{},true),'FORBIDDEN'));
 await check('authorized operations may edit inventory',async()=>{await inv.saveUnit(tenantSql(sql),ops,{...input,id:unit.id,version:1,status:'unavailable'});});
 await check('stale unit version rejected',()=>reject(()=>inv.saveUnit(tenantSql(sql),admin,{...input,id:unit.id,version:1}),'UNIT_CHANGED_OR_COMMITTED'));
 await check('status history records initial and changed states',async()=>{const rows=await inv.unitHistory(tenantSql(sql),sales,a,project,unit.id);assert.equal(rows.length,2);assert.equal(rows[0].previous_status,'available');assert.equal(rows[0].next_status,'unavailable');assert.equal(rows[1].previous_status,null);});
 await check('filter by building floor status and literal search',async()=>{const r=await inv.inventory(tenantSql(sql),admin,a,project,{building:'B1',floor:'F1',status:'unavailable',search:'U-1'});assert.equal(r.units.length,1);const empty=await inv.inventory(tenantSql(sql),admin,a,project,{search:'%'});assert.equal(empty.units.length,0);});
 await check('negative or fractional minor prices and invalid area rejected',async()=>{for(const extra of [{proposed_price:'-1'},{proposed_price:'0.001'},{area:'0'}])await assert.rejects(()=>inv.saveUnit(tenantSql(sql),admin,{...input,...extra}));});
 await check('booking and sold states cannot be set through inventory API',async()=>{for(const status of ['pending','reserved','sold'])await assert.rejects(()=>inv.saveUnit(tenantSql(sql),admin,{...input,id:unit.id,version:2,status}));});
 await check('unit deactivation preserves record and audit',async()=>{await inv.saveUnit(tenantSql(sql),admin,{...input,id:unit.id,version:2,status:'unavailable',active:false});const rows=await inv.inventory(tenantSql(sql),admin,a,project,{});assert.equal(rows.units[0].active,false);assert.equal(rows.units[0].version,3);});
 const committed=crypto.randomUUID();await sql`INSERT INTO inventory_units(id,company_id,project_id,code,building,floor,category,area,proposed_price_minor,status) VALUES(${committed},${a},${project},'COMMITTED','B1','F1','Office',100,100,'reserved')`;
 await check('committed units reject administrative edits',()=>reject(()=>inv.saveUnit(tenantSql(sql),admin,{...input,id:committed,version:1,code:'COMMITTED'}),'UNIT_CHANGED_OR_COMMITTED'));
 await check('database protects reserved units from direct update',()=>assert.rejects(async()=>await sql`UPDATE inventory_units SET area=101 WHERE id=${committed}`));
 await check('database rejects cross-company project reference',()=>assert.rejects(async()=>await sql`INSERT INTO inventory_units(company_id,project_id,code,building,floor,category,area,proposed_price_minor) VALUES(${a},${other},'CROSS','B','F','C',1,1)`));
 await check('RLS hides other company units and status history',async()=>{const r=await sql.transaction([sql`SET LOCAL ROLE bunyra_tenant`,sql`SELECT set_config('app.company_id',${b},true),set_config('app.user_id',${admin.userId},true)`,sql`SELECT id FROM inventory_units`,sql`SELECT id FROM unit_status_history`]);assert.equal(r[2].length,0);assert.equal(r[3].length,0);});
 await sql`INSERT INTO member_permissions(company_id,user_id,project_id,action,allowed) VALUES(${a},${ops.userId},${project},'inventory.write',false)`;
 await check('explicit project deny overrides operations role',()=>reject(()=>inv.saveUnit(tenantSql(sql),ops,{...input,id:unit.id,version:3}),'FORBIDDEN'));
 await check('audit snapshots retain changed area price status and version',async()=>{const rows=await sql`SELECT before_data,after_data FROM audit_logs WHERE company_id=${a} AND action='inventory.updated' ORDER BY id`;assert.equal(rows.length,2);assert.equal(rows[0].before_data.status,'available');assert.equal(rows[0].after_data.status,'unavailable');assert.equal(rows[1].after_data.active,false);});
 return {passed:checks.length,checks,fixture_companies:[a,b]};
}
