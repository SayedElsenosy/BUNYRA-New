import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import assert from 'node:assert/strict';
import * as p from '../.sites-runtime/tests/projects.mjs';
export async function runProjectTests(sql){
 const checks=[];async function check(name,fn){await fn();checks.push({name,passed:true});}
 const config={name:'Project test',name_en:'',code:'TEST',location:'Test location',type:'mixed',currency:'EGP',financial_notes:'',phases:[{code:'P',name:'Phase'}],buildings:[{code:'B',name:'Building',phase:'P'}],floors:[{code:'F',name:'Floor',building:'B',plan_url:''}],categories:[{code:'C',name:'Office'}],units:[{code:'U',floor:'F',category:'C',area:'100.25',price:'1000.01',active:true}],plans:[{code:'PAY',name:'Plan',down_payment_bps:1500,installments:7,interval_months:3}]};
 await check('complete draft schema accepts valid hierarchy',()=>p.configurationSchema.parse(config));
 await check('duplicate unit codes rejected case insensitively',()=>assert.equal(p.configurationSchema.safeParse({...config,units:[...config.units,{...config.units[0],code:'u'}]}).success,false));
 await check('cross-structure floor reference rejected',()=>assert.equal(p.configurationSchema.safeParse({...config,units:[{...config.units[0],floor:'other'}]}).success,false));
 await check('unsafe floor-plan URL rejected',()=>assert.equal(p.configurationSchema.safeParse({...config,floors:[{...config.floors[0],plan_url:'javascript:alert(1)'}]}).success,false));
 await check('negative area and sub-cent prices rejected',()=>{assert.equal(p.configurationSchema.safeParse({...config,units:[{...config.units[0],area:'-2'}]}).success,false);assert.throws(()=>p.minorUnits('0.001'));});
 await check('unknown published flag rejected',()=>assert.equal(p.configurationSchema.safeParse({...config,published:true}).success,false));
 await check('draft never implies sales publication',()=>assert.equal(p.readiness(config).published,false));
 await check('exact cents avoid floating point rounding',()=>assert.equal(p.minorUnits('999999999999.99'),99999999999999n));
 await check('installment allocation preserves total across boundaries',()=>{for(const price of ['0','0.01','1.01','1000.01','999999999999.99'])for(const bps of [0,1,1500,9999,10000])for(const count of [1,7,600]){const r=p.calculatePlan(price,bps,count);assert.equal(BigInt(r.down_payment)+r.installments.reduce((s,v)=>s+BigInt(v),0n),BigInt(r.total));const amounts=r.installments.map(BigInt);assert.ok(amounts[0]-amounts.at(-1)<=1n);}});
 await check('invalid payment bounds rejected',()=>{assert.throws(()=>p.calculatePlan('1',10001,7));assert.throws(()=>p.calculatePlan('1',0,0));});
 const a=crypto.randomUUID(),b=crypto.randomUUID(),tag=a.slice(0,8),admin={userId:'project-admin-'+tag,email:'admin-'+tag+'@example.com'},sales={userId:'project-sales-'+tag,email:'sales-'+tag+'@example.com'};
 await sql`INSERT INTO companies(id,name) VALUES(${a},'Project fixture A'),(${b},'Project fixture B')`;
 await sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${a},${admin.userId},${admin.email},'company_admin'),(${a},${sales.userId},${sales.email},'sales')`;
 const input={company_id:a,version:0,configuration:config};let created;
 await check('admin creates draft and setup atomically',async()=>{created=await p.saveProject(tenantSql(sql),admin,input);assert.equal(created.version,1);});
 await check('sales cannot change setup or draft prices',()=>assert.rejects(()=>p.saveProject(tenantSql(sql),sales,{...input,id:created.id,version:1}),e=>e.code==='FORBIDDEN'));
 await check('cross-company write denied',()=>assert.rejects(()=>p.saveProject(tenantSql(sql),admin,{...input,company_id:b}),e=>e.code==='FORBIDDEN'));
 await check('forged platform access denied',()=>assert.rejects(()=>p.projectList(tenantSql(sql),admin,b,true),e=>e.code==='FORBIDDEN'));
 await check('draft resumes with stored rows and version',async()=>{const r=await p.projectList(tenantSql(sql),admin,a);assert.equal(r.projects[0].configuration.units[0].price,'1000.01');assert.equal(r.projects[0].version,1);});
 await check('sales cannot see draft commercial configuration',async()=>{const r=await p.projectList(tenantSql(sql),sales,a);assert.equal(r.projects[0].configuration,null);assert.equal(r.can_create,false);});
 await check('draft update increments version',async()=>{const r=await p.saveProject(tenantSql(sql),admin,{...input,id:created.id,version:1,configuration:{...config,name:'Renamed test'}});assert.equal(r.version,2);});
 await check('stale draft update rejected',()=>assert.rejects(()=>p.saveProject(tenantSql(sql),admin,{...input,id:created.id,version:1}),e=>e.code==='VERSION_CONFLICT'));
 await check('duplicate project code rolls back project creation',async()=>{await assert.rejects(()=>p.saveProject(tenantSql(sql),admin,{...input,configuration:{...config,name:'Other name',code:'test'}}));const rows=await sql`SELECT id FROM projects WHERE company_id=${a}`;assert.equal(rows.length,1);});
 await check('RLS prevents other-company draft reads',async()=>{const r=await sql.transaction([sql`SET LOCAL ROLE bunyra_tenant`,sql`SELECT set_config('app.company_id',${b},true),set_config('app.user_id',${admin.userId},true)`,sql`SELECT project_id FROM project_setups`]);assert.equal(r[2].length,0);});
 await check('audit contains creation and update snapshots',async()=>{const rows=await sql`SELECT action,before_data,after_data FROM audit_logs WHERE company_id=${a} AND action IN ('project.draft_created','project.draft_updated') ORDER BY id`;assert.equal(rows.length,2);assert.equal(rows[1].before_data.version,1);assert.equal(rows[1].after_data.version,2);});
 return {passed:checks.length,checks,fixture_companies:[a,b]};
}
