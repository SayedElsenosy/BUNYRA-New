import assert from 'node:assert/strict';
import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import {workspaceHub,completeWorkItem} from '../.sites-runtime/tests/workspace-hub.mjs';
import {createCustomer,createLead,crmOverview} from '../.sites-runtime/tests/crm.mjs';
import {createAccount} from '../.sites-runtime/tests/accounts.mjs';
import {savePriceBook,approvePriceBook} from '../.sites-runtime/tests/pricing.mjs';
import {createBooking,updateBooking,createContract,commercialOverview} from '../.sites-runtime/tests/commercial.mjs';
import {setPermission} from '../.sites-runtime/tests/service.mjs';

export async function runHubTests(raw){
 delete process.env.BUNYRA_NOTIFICATION_WEBHOOK_URL;
 const owner={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
 assert.equal((await raw`SELECT user_id FROM platform_owner`)[0]?.user_id,owner.userId,'DEV database required');
 const checks=[],check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log('PASS '+name);};
 const deny=(fn,code='FORBIDDEN')=>assert.rejects(fn,e=>e.code===code||e.message===code),fresh=()=>tenantSql(raw);
 const company=crypto.randomUUID(),other=crypto.randomUUID(),project=crypto.randomUUID(),blocked=crypto.randomUUID(),foreignProject=crypto.randomUUID(),team=crypto.randomUUID(),tag=company.slice(0,8);
 const actor=r=>({userId:'hub-'+tag+'-'+r,email:r+'-'+tag+'@example.com'}),admin=actor('admin'),s2=actor('sales2'),ops=actor('ops'),fm=actor('finance'),manager=actor('manager'),reader=actor('reader'),foreign=actor('foreign');
 const units=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
 await raw.transaction([
  raw`INSERT INTO companies(id,name,account_limit) VALUES(${company},${'Hub QA '+tag},20),(${other},'Foreign hub company',10)`,
  raw`INSERT INTO projects(id,company_id,name) VALUES(${project},${company},'Hub QA project'),(${blocked},${company},'Hub QA restricted'),(${foreignProject},${other},'Foreign hub project')`,
  raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${admin.userId},${admin.email},'company_admin'),(${company},${s2.userId},${s2.email},'sales'),(${company},${ops.userId},${ops.email},'operations'),(${company},${fm.userId},${fm.email},'finance_manager'),(${company},${manager.userId},${manager.email},'sales_manager'),(${company},${reader.userId},${reader.email},'sales'),(${other},${foreign.userId},${foreign.email},'company_admin')`,
  raw`INSERT INTO company_settings(company_id,currency,time_zone,locale) VALUES(${company},'EGP','Pacific/Kiritimati','ar')`,
  raw`INSERT INTO inventory_units(id,company_id,project_id,code,building,floor,category,area,proposed_price_minor) VALUES(${units[0]},${company},${project},'HUB-01','A','1','Office',100,100000),(${units[1]},${company},${project},'HUB-02','A','1','Office',100,100000),(${units[2]},${company},${project},'HUB-03','A','1','Office',100,100000),(${units[3]},${company},${blocked},'HUB-BLOCKED','B','2','Office',100,100000),(${units[4]},${other},${foreignProject},'HUB-FOREIGN','Z','9','Office',100,100000)`
 ]);
 const account=await createAccount(fresh(),owner,{company_id:company,username:'hub-sales-'+tag,display_name:'Hub QA Sales',password:'Hub QA fixture password 2026!',email:'',role:'sales'},true);
 const s1={userId:account.user_id,email:account.username};
 const customRole=(await raw`INSERT INTO custom_roles(company_id,name,permissions) VALUES(${company},'Hub read only',${JSON.stringify({'company.read':true,'leads.read':true})}::jsonb) RETURNING id`)[0];
 await raw`UPDATE memberships SET custom_role_id=${customRole.id} WHERE company_id=${company} AND user_id=${reader.userId}`;
 const customer1=await createCustomer(fresh(),s1,{company_id:company,full_name:'Hub QA first customer',phone:'+201001111111',email:''});
 const customer2=await createCustomer(fresh(),s2,{company_id:company,full_name:'Hub QA second customer',phone:'+201002222222',email:''});
 const customer3=await createCustomer(fresh(),admin,{company_id:company,full_name:'Hub QA read only customer',phone:'+201003333333',email:''});
 const hidden=await createCustomer(fresh(),s1,{company_id:company,full_name:'Hub QA restricted customer',phone:'+201004444444',email:''});
 const otherCustomer=await createCustomer(fresh(),foreign,{company_id:other,full_name:'Hub QA foreign customer',phone:'+201005555555',email:''});
 const lead1=await createLead(fresh(),s1,{company_id:company,customer_id:customer1.id,source:'fixture',project_id:project});
 const lead2=await createLead(fresh(),s2,{company_id:company,customer_id:customer2.id,source:'fixture',project_id:project});
 const lead3=await createLead(fresh(),admin,{company_id:company,customer_id:customer3.id,source:'fixture',project_id:project,owner_user_id:reader.userId});
 await createLead(fresh(),s1,{company_id:company,customer_id:hidden.id,source:'fixture',project_id:blocked});
 await createLead(fresh(),foreign,{company_id:other,customer_id:otherCustomer.id,source:'fixture',project_id:foreignProject});
 await raw.transaction([
  raw`INSERT INTO crm_sales_teams(id,company_id,name,manager_user_id) VALUES(${team},${company},'Hub QA team',${manager.userId})`,
  raw`INSERT INTO crm_sales_team_members(company_id,team_id,user_id) VALUES(${company},${team},${s1.userId})`,
  raw`INSERT INTO crm_customers(company_id,full_name,phone,normalized_phone,created_by) SELECT ${company},'Hub QA contact '||n,'+20200'||lpad(n::text,8,'0'),'+20200'||lpad(n::text,8,'0'),${s1.userId} FROM generate_series(1,24) n`
 ]);
 const followIds=[];
 for(const [i,bucket] of ['overdue','today','tomorrow','later'].entries()){
  const due=(await raw`SELECT CASE ${bucket} WHEN 'overdue' THEN now()-interval '2 days' WHEN 'today' THEN (((now() AT TIME ZONE 'Pacific/Kiritimati')::date+1)::timestamp AT TIME ZONE 'Pacific/Kiritimati')-interval '1 second' WHEN 'tomorrow' THEN (((now() AT TIME ZONE 'Pacific/Kiritimati')::date+1)::timestamp+interval '12 hours') AT TIME ZONE 'Pacific/Kiritimati' ELSE now()+interval '4 days' END AS value`)[0].value;
  followIds.push((await raw`INSERT INTO crm_follow_ups(company_id,customer_id,lead_id,due_at,title,assigned_to,created_by) VALUES(${company},${customer1.id},${lead1.id},${due},${'Hub QA '+bucket},${s1.userId},${s1.userId}) RETURNING id`)[0].id);
 }
 const otherFollow=(await raw`INSERT INTO crm_follow_ups(company_id,customer_id,lead_id,due_at,title,assigned_to,created_by) VALUES(${company},${customer2.id},${lead2.id},now()-interval '2 days','Hub QA other employee',${s2.userId},${s2.userId}) RETURNING id`)[0].id;
 const readFollow=(await raw`INSERT INTO crm_follow_ups(company_id,customer_id,lead_id,due_at,title,assigned_to,created_by) VALUES(${company},${customer3.id},${lead3.id},now()-interval '2 days','Hub QA read only task',${reader.userId},${admin.userId}) RETURNING id`)[0].id;
 const book=await savePriceBook(fresh(),admin,{company_id:company,project_id:project,version:0,name:'Hub QA approved prices',plans:[{code:'PAY',name:'Hub installments',down_payment_bps:2000,installments:4,interval_months:1,adjustment_bps:0}],prices:units.slice(0,3).map(unit_id=>({unit_id,source_unit_version:1,price:'1000.00',plan_codes:['PAY']}))});
 await approvePriceBook(fresh(),admin,{company_id:company,project_id:project,id:book.id,version:book.version,expected_revision:0});
 const plan=(await raw`SELECT id FROM price_book_plans WHERE book_id=${book.id}`)[0].id;
 const booking=async(unit,seller,customer,lead)=>(await createBooking(fresh(),seller,{company_id:company,project_id:project,unit_id:unit,customer_id:customer.id,lead_id:lead.id,plan_id:plan,customer_name:customer.full_name,customer_phone:customer.phone,reservation_amount:'200.00',date:'2020-01-01'})).booking;
 const b1=await booking(units[0],s1,customer1,lead1);
 await updateBooking(fresh(),ops,{company_id:company,booking_id:b1.id},'approve');
 await updateBooking(fresh(),fm,{company_id:company,booking_id:b1.id,received_amount:'200.00'},'confirm_receipt');
 const contract=(await createContract(fresh(),ops,{company_id:company,booking_id:b1.id,date:'2020-01-01'})).contract;
 const b2=await booking(units[1],s2,customer2,lead2),b3=await booking(units[2],s1,customer1,lead1);
 await updateBooking(fresh(),ops,{company_id:company,booking_id:b3.id},'approve');
 const get=(who,kind='overview',extra={})=>workspaceHub(fresh(),who,{company,kind,...extra});
 await check('Sales dashboard uses full scoped customer counts beyond one page',async()=>{const d=await get(s1);assert.equal(d.metrics.customers,26);assert.equal(d.metrics.open_leads,2);assert.equal(d.capabilities.finance,false);assert.equal(d.metrics.active_contracts,0);assert.equal(d.metrics.work.total,4);});
 await check('Own and other employee tasks never mix',async()=>{const d=await get(s1,'tasks');assert.deepEqual(new Set(d.items.map(x=>x.id)),new Set(followIds));assert.ok(!d.items.some(x=>x.id===otherFollow));});
 await check('Overdue, today, tomorrow and waiting buckets are disjoint',async()=>{const d=await get(s1,'tasks');assert.equal(d.summary.overdue,1);assert.equal(d.summary.today,1);assert.equal(d.summary.tomorrow,1);assert.equal(d.summary.waiting,0);assert.equal(d.time_zone,'Pacific/Kiritimati');});
 await check('Task date filters use company-local tomorrow',async()=>{const d=await get(s1,'tasks',{bucket:'tomorrow'});assert.equal(d.total,1);assert.equal(d.items[0].id,followIds[2]);});
 await check('Manager sees managed team without unrelated salespeople',async()=>{const d=await get(manager,'tasks');assert.equal(d.total,4);assert.ok(!d.items.some(x=>x.id===otherFollow));});
 await check('Operations receives submitted booking approvals without fake deadlines',async()=>{const d=await get(ops,'tasks',{bucket:'waiting'});assert.equal(d.total,1);assert.equal(d.items[0].id,b2.id);assert.equal(d.items[0].due_at,null);});
 await check('Accounts receives pending receipts and overdue active installments',async()=>{const d=await get(fm,'tasks');assert.ok(d.items.some(x=>x.kind==='receipt_confirmation'&&x.id===b3.id));assert.ok(d.items.some(x=>x.kind==='installment'&&x.record_id===contract.id));assert.ok(!d.items.some(x=>x.kind==='follow_up'));});
 await check('Search paginates on server and counts all authorized contacts',async()=>{const d=await get(s1,'search',{q:'Hub QA',entity:'customer'});assert.equal(d.total,26);assert.equal(d.items.length,20);const next=await get(s1,'search',{q:'Hub QA',entity:'customer',page:1});assert.equal(next.items.length,6);assert.ok(!next.items.some(x=>d.items.some(y=>x.id===y.id)));});
 await check('Searching customer names cannot disclose other salespeople',async()=>{const d=await get(s1,'search',{q:'second customer'});assert.equal(d.total,0);});
 await check('Arabic digits find the actual normalized phone',async()=>{const d=await get(s1,'search',{q:'٠١٠٠١١١١١١١',entity:'customer'});assert.equal(d.items[0].id,customer1.id);});
 await check('Literal SQL-like search text is not executable or a wildcard',async()=>{const d=await get(s1,'search',{q:"%' OR 1=1 --"});assert.equal(d.total,0);});
 await check('Single-character searches return no unbounded result dump',async()=>{const d=await get(admin,'search',{q:'H'});assert.equal(d.total,0);});
 await check('Opening an exact customer rechecks salesperson scope',async()=>{await deny(()=>get(s1,'record',{entity:'customer',id:customer2.id}),'NOT_FOUND');const d=await get(s1,'record',{entity:'customer',id:customer1.id});assert.equal(d.items[0].details.phone,customer1.phone);});
 await check('Cross-company search has no foreign records or counts',async()=>{const d=await get(admin,'search',{q:'foreign'});assert.equal(d.total,0);await deny(()=>get(admin,'record',{entity:'unit',id:units[4]}),'NOT_FOUND');});
 await check('Forged owner mode never bypasses verified platform identity',()=>deny(()=>workspaceHub(fresh(),s1,{company:other},true)));
 await check('Cross-company API access is rejected',()=>deny(()=>workspaceHub(fresh(),s1,{company:other})));
 await check('Verified owner can inspect another company in audited scope',async()=>{const d=await workspaceHub(fresh(),owner,{company:other,kind:'search',q:'foreign'},true);assert.ok(d.total>0);assert.equal(d.owner,true);});
 await check('Finance-only role cannot search customer contact directory or units',async()=>{const d=await get(fm,'search',{q:'Hub'});assert.ok(d.items.every(x=>['booking','contract'].includes(x.kind)));assert.equal(d.capabilities.crm,false);});
 await check('Sales cannot open financial contract details',()=>deny(()=>get(s1,'record',{entity:'contract',id:contract.id}),'NOT_FOUND'));
 await check('Exact booking link is constrained before the old list limit',async()=>{const d=await commercialOverview(fresh(),s2,company,false,b2.id);assert.equal(d.bookings.length,1);assert.equal(d.bookings[0].id,b2.id);});
 await check('Foreign booking target never widens the original booking scope',async()=>{const d=await commercialOverview(fresh(),s1,company,false,b2.id);assert.equal(d.bookings.length,0);});
 await check('Exact contract link limits installments to the selected contract',async()=>{const d=await commercialOverview(fresh(),fm,company,false,contract.id);assert.ok(d.due.length>0);assert.ok(d.due.every(x=>x.contract_id===contract.id));});
 await check('Exact CRM target is found beyond normal result paging',async()=>{const d=await crmOverview(fresh(),s1,company,{customer:customer1.id});assert.equal(d.customers.length,1);assert.equal(d.customers[0].id,customer1.id);});
 await check('Project inventory deny removes blocked unit search results',async()=>{await setPermission(fresh(),admin,{company_id:company,user_id:s1.userId,project_id:blocked,action:'inventory.read',allowed:false});const d=await get(s1,'search',{q:'HUB-BLOCKED'});assert.equal(d.total,0);await deny(()=>get(s1,'record',{entity:'unit',id:units[3]}),'NOT_FOUND');});
 await check('Project CRM deny removes customer and lead counts before aggregation',async()=>{await setPermission(fresh(),admin,{company_id:company,user_id:s1.userId,project_id:blocked,action:'leads.read',allowed:false});const d=await get(s1);assert.equal(d.metrics.open_leads,1);assert.equal(d.metrics.customers,25);const search=await get(s1,'search',{q:'restricted customer'});assert.equal(search.total,0);});
 await check('Read-only custom role can see but cannot complete its follow-up',async()=>{const d=await get(reader,'tasks');assert.equal(d.total,1);assert.equal(d.capabilities.write_crm,false);await deny(()=>completeWorkItem(fresh(),reader,{company_id:company,id:readFollow,operation:'complete_follow_up'}));});
 await check('Cannot mark another representative follow-up complete',()=>deny(()=>completeWorkItem(fresh(),s2,{company_id:company,id:followIds[0],operation:'complete_follow_up'}),'WORK_ITEM_UNAVAILABLE'));
 await check('Task completion is atomic, audited, and cannot be repeated',async()=>{const input={company_id:company,id:followIds[0],operation:'complete_follow_up'};const [a,b]=await Promise.allSettled([completeWorkItem(fresh(),s1,input),completeWorkItem(fresh(),s1,input)]);assert.equal([a,b].filter(x=>x.status==='fulfilled').length,1);const log=await raw`SELECT id FROM audit_logs WHERE company_id=${company} AND action='crm.follow_up_updated' AND after_data->>'id'=${followIds[0]}`;assert.equal(log.length,1);assert.equal((await get(s1,'tasks')).total,3);});
 await check('Scoped wrapper retains RLS even for unfiltered SQL after hub read',async()=>{const sql=fresh();await workspaceHub(sql,s1,{company});const rows=await sql`SELECT DISTINCT company_id FROM inventory_units`;assert.deepEqual(rows.map(x=>x.company_id),[company]);});
 await check('Invalid page, record identifier, kind and oversized query are rejected',async()=>{for(const invalid of [{page:-1},{page:0.5},{id:'invalid'},{kind:'unsafe'},{q:'x'.repeat(101)}])await assert.rejects(()=>get(s1,'search',invalid));});
 return {passed:checks.length,checks,fixture:{company,project,contract:contract.id,customer:customer1.id,booking:b2.id,ui_username:account.username,name:'Hub QA '+tag}};
}
