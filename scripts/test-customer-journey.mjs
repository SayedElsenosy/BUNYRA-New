import assert from 'node:assert/strict';
import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import {customerJourney} from '../.sites-runtime/tests/customer-journey.mjs';
import {addInteraction,crmOverview} from '../.sites-runtime/tests/crm.mjs';
import {buyerOverview} from '../.sites-runtime/tests/buyer.mjs';
import {setPermission} from '../.sites-runtime/tests/service.mjs';

export async function testCustomerJourney(raw,f){
 assert.equal((await raw`SELECT user_id FROM platform_owner`)[0]?.user_id,'identity-test-platform-owner','DEV database required');
 const checks=[],check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log('PASS '+name);};
 const company=f.company,customer=f.customer,tag=company.slice(0,8),fresh=()=>tenantSql(raw);
 const actor=r=>({userId:`hub-${tag}-${r}`,email:`${r}-${tag}@example.com`});
 const salesAccount=(await raw`SELECT user_id,email FROM app_accounts WHERE company_id=${company} AND username=${f.ui_username}`)[0];
 const sales={userId:salesAccount.user_id,email:salesAccount.email},admin=actor('admin'),other=actor('sales2'),manager=actor('manager'),ops=actor('ops'),reader=actor('reader');
 const get=(who,tab='activity',extra={})=>customerJourney(fresh(),who,{company,customer,tab,...extra});
 const denied=(fn,code='FORBIDDEN')=>assert.rejects(fn,e=>e.code===code||e.message===code);
 const own=crypto.randomUUID(),foreign=crypto.randomUUID(),callBody='Completed test call '+crypto.randomUUID();
 const expectedOwner=(await raw`SELECT email FROM memberships WHERE company_id=${company} AND user_id=${sales.userId}`)[0].email;
 const requestBaseline=(await get(sales,'requests')).counts.requests||0;
 await raw.transaction([
  raw`INSERT INTO buyer_requests(id,company_id,customer_id,project_id,unit_category,notes,created_by) VALUES(${own},${company},${customer},${f.project},'Office','Own request',${sales.userId}),(${foreign},${company},${customer},${f.project},'Office','Private colleague request',${other.userId})`,
  raw`INSERT INTO crm_interactions(company_id,customer_id,kind,body,created_by) VALUES(${company},${customer},'note','Own activity',${sales.userId}),(${company},${customer},'note','Private colleague activity',${other.userId})`,
  raw`INSERT INTO crm_leads(company_id,customer_id,source,owner_user_id,project_id,interest,created_by) VALUES(${company},${customer},'private source',${other.userId},${f.project},'Private colleague lead',${other.userId})`,
 ]);
 await check('Customer identity is the original shared contact after contract creation',async()=>{const d=await get(admin);assert.equal(d.customer.id,customer);assert.equal(d.counts.contracts,1);});
 await check('Sales profile does not expose contract or collection tabs or amounts',async()=>{const d=await get(sales);assert.ok(!d.tabs.includes('contracts'));assert.ok(!d.tabs.includes('collections'));assert.ok(!JSON.stringify(d).includes('amount_minor'));assert.ok(d.rows.every(r=>!['contract','collection'].includes(r.kind)));});
 await check('Direct financial tab request is denied for Sales',()=>denied(()=>get(sales,'contracts')));
 await check('Operations profile does not gain finance through CRM access',()=>denied(()=>get(ops,'collections')));
 await check('Own activity excludes a colleague null-lead activity',async()=>{const d=await get(sales);assert.ok(d.rows.some(r=>r.body==='Own activity'));assert.ok(!d.rows.some(r=>r.body==='Private colleague activity'));});
 await check('Team manager sees team activity without unrelated colleague activity',async()=>{const d=await get(manager);assert.ok(d.rows.some(r=>r.body==='Own activity'));assert.ok(!d.rows.some(r=>r.body==='Private colleague activity'));});
 await check('Admin can see company activities',async()=>{const d=await get(admin);assert.ok(d.rows.some(r=>r.body==='Private colleague activity'));});
 await check('Lead ownership is enforced before profile counts and pagination',async()=>{const d=await get(sales,'leads');assert.ok(d.rows.length>0);assert.ok(d.rows.every(r=>r.body!=='Private colleague lead'));assert.ok(d.rows.every(r=>r.extra.owner===expectedOwner));});
 await check('Buyer requests preserve customer, project and creator scope',async()=>{const d=await get(sales,'requests');assert.equal(d.counts.requests,requestBaseline+1);assert.ok(d.rows.some(r=>r.id===own));assert.ok(d.rows.every(r=>r.body!=='Private colleague request'));});
 await check('Customer profile booking records use the existing salesman scope',async()=>{const d=await get(sales,'bookings');assert.ok(d.rows.length>0);assert.ok(d.rows.every(r=>r.id!==f.booking));});
 await check('Read-only custom role receives no write or new-request controls',async()=>{const d=await get(reader);assert.equal(d.can_write,false);assert.equal(d.can_request,false);});
 await check('Project booking deny removes booking records and timeline entries',async()=>{await setPermission(fresh(),admin,{company_id:company,user_id:sales.userId,project_id:f.project,action:'bookings.read',allowed:false});try{const d=await get(sales);assert.ok(d.rows.every(r=>r.kind!=='booking'));assert.ok(!d.counts.bookings);}finally{await setPermission(fresh(),admin,{company_id:company,user_id:sales.userId,project_id:f.project,action:'bookings.read',allowed:true});}});
 await check('Project CRM deny removes leads and requests before totals',async()=>{await setPermission(fresh(),admin,{company_id:company,user_id:sales.userId,project_id:f.project,action:'leads.read',allowed:false});try{const d=await get(sales);assert.ok(!d.counts.leads);assert.ok(!d.counts.requests);}finally{await setPermission(fresh(),admin,{company_id:company,user_id:sales.userId,project_id:f.project,action:'leads.read',allowed:true});}});
 await check('Foreign company membership cannot read profile',()=>denied(()=>get({userId:'no-membership',email:'nobody@example.com'})));
 await check('Nonexistent customer is unavailable',()=>denied(()=>get(sales,'activity',{customer:crypto.randomUUID()}),'NOT_FOUND'));
 await check('Invalid identifiers, page and tab are rejected',async()=>{for(const extra of [{customer:'bad'},{page:-1},{page:0.1},{tab:'secrets'}])await assert.rejects(()=>get(sales,'activity',extra));});
 await check('Read-only profile fetch does not manufacture an interaction',async()=>{const before=(await raw`SELECT count(*)::int n FROM crm_interactions WHERE company_id=${company}`)[0].n;await get(sales);assert.equal((await raw`SELECT count(*)::int n FROM crm_interactions WHERE company_id=${company}`)[0].n,before);});
 await check('Explicit logged call appears once with an audit record',async()=>{await addInteraction(fresh(),sales,{company_id:company,customer_id:customer,kind:'call',body:callBody});const d=await get(sales);assert.equal(d.rows.filter(r=>r.body===callBody).length,1);assert.ok((await raw`SELECT id FROM audit_logs WHERE company_id=${company} AND actor_id=${sales.userId} AND action='crm.interaction_added'`).length>0);});
 await check('Legacy CRM response uses the same private null-lead activity scope',async()=>{const d=await crmOverview(fresh(),sales,company,{customer});assert.ok(!d.interactions.some(r=>r.body==='Private colleague activity'));});
 await check('Authorized contract tab retains the original contract and frozen value',async()=>{const d=await get(admin,'contracts');const expected=(await raw`SELECT value_final_minor::text,commission_currency FROM contracts WHERE company_id=${company} AND id=${f.contract}`)[0];assert.equal(d.rows.length,1);assert.equal(d.rows[0].id,f.contract);assert.equal(d.rows[0].extra.amount_minor,expected.value_final_minor);assert.equal(d.rows[0].extra.currency,expected.commission_currency);});
 await check('Project finance deny removes financial rows from every profile section',async()=>{await setPermission(fresh(),{userId:'identity-test-platform-owner',email:'platform-test@example.com'},{company_id:company,user_id:admin.userId,project_id:f.project,action:'finance.read',allowed:false},true);try{const d=await get(admin);assert.ok(!d.counts.contracts);assert.ok(!d.counts.collections);assert.ok(d.rows.every(r=>!['contract','collection'].includes(r.kind)));}finally{await setPermission(fresh(),{userId:'identity-test-platform-owner',email:'platform-test@example.com'},{company_id:company,user_id:admin.userId,project_id:f.project,action:'finance.read',allowed:true},true);}});
 await check('Finance-only account cannot acquire contact directory through profile URL',()=>denied(()=>get(actor('finance'))));
 await check('Empty related data remains an empty profile without manufactured leads',async()=>{const id=crypto.randomUUID();await raw`INSERT INTO crm_customers(id,company_id,full_name,phone,normalized_phone,created_by) VALUES(${id},${company},'Empty contact',${id},${id},${sales.userId})`;const d=await get(sales,'activity',{customer:id});assert.equal(d.rows.length,0);assert.deepEqual(d.counts,{});});
 await raw`INSERT INTO crm_interactions(company_id,customer_id,kind,body,created_by) SELECT ${company}::uuid,${customer}::uuid,'note','Pagination '||n,${sales.userId} FROM generate_series(1,23) n`;
 await check('Activity uses full counts and stable server pagination',async()=>{const a=await get(sales),b=await get(sales,'activity',{page:1});assert.equal(a.rows.length,20);assert.ok(a.counts.activity>20);assert.equal(a.counts.activity,b.counts.activity);assert.ok(b.rows.length>0);assert.ok(!b.rows.some(r=>a.rows.some(x=>x.id===r.id&&x.kind===r.kind)));});
 await check('Buyer customer context targets the exact contact before old list limit',async()=>{const d=await buyerOverview(fresh(),sales,company,false,{customer});assert.equal(d.customers.length,1);assert.equal(d.customers[0].id,customer);assert.ok(d.requests.every(r=>r.customer_id===customer));});
 await check('Buyer request context returns the selected authorized request',async()=>{const d=await buyerOverview(fresh(),sales,company,false,{request:own});assert.equal(d.requests.length,1);assert.equal(d.requests[0].id,own);});
 await check('Buyer exact target never widens to another salesperson request',async()=>{const d=await buyerOverview(fresh(),sales,company,false,{request:foreign});assert.equal(d.requests.length,0);});
 await check('Tenant wrapper remains bound after profile read',async()=>{const sql=fresh();await customerJourney(sql,sales,{company,customer});assert.deepEqual((await sql`SELECT DISTINCT company_id FROM crm_customers`).map(r=>r.company_id),[company]);});
 return {passed:checks.length,checks,fixture:f};
}
