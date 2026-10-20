import assert from 'node:assert/strict';
import {tenantSql} from '../.sites-runtime/tests/tenant.mjs';
import {issueSavedOffer,downloadSavedOffer,listSavedOffers,savedOfferDetail} from '../.sites-runtime/tests/offers.mjs';
import {createBooking,updateBooking,createContract} from '../.sites-runtime/tests/commercial.mjs';
import {createBuyerRequest} from '../.sites-runtime/tests/buyer.mjs';
import {createCustomer,createLead} from '../.sites-runtime/tests/crm.mjs';
import {savePriceBook,approvePriceBook} from '../.sites-runtime/tests/pricing.mjs';
import {createAccount} from '../.sites-runtime/tests/accounts.mjs';
import {setPermission} from '../.sites-runtime/tests/service.mjs';
import {customerJourney} from '../.sites-runtime/tests/customer-journey.mjs';
import {purgeCompany} from '../.sites-runtime/tests/companies.mjs';
export async function testSavedOffers(raw){
 delete process.env.BUNYRA_NOTIFICATION_WEBHOOK_URL;
 const owner={userId:'identity-test-platform-owner',email:'platform-test@example.com'};
 assert.equal((await raw`SELECT user_id FROM platform_owner`)[0]?.user_id,owner.userId,'DEV only');
 const checks=[],check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log('PASS '+name);},fresh=()=>tenantSql(raw),deny=(fn,c='FORBIDDEN')=>assert.rejects(fn,e=>e.code===c||e.message===c);
 const company=crypto.randomUUID(),project=crypto.randomUUID(),otherProject=crypto.randomUUID(),foreignCompany=crypto.randomUUID(),tag=company.slice(0,8),team=crypto.randomUUID(),units=Array.from({length:6},()=>crypto.randomUUID());
 const actor=r=>({userId:'offer-'+tag+'-'+r,email:r+'-'+tag+'@example.com'}),admin=actor('admin'),s2=actor('sales2'),manager=actor('manager'),ops=actor('ops'),finance=actor('finance');
 await raw.transaction([
 raw`INSERT INTO companies(id,name,account_limit) VALUES(${company},${'Offer QA '+tag},20),(${foreignCompany},'Foreign offer company',10)`,
 raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${company},${admin.userId},${admin.email},'company_admin'),(${company},${s2.userId},${s2.email},'sales'),(${company},${manager.userId},${manager.email},'sales_manager'),(${company},${ops.userId},${ops.email},'operations'),(${company},${finance.userId},${finance.email},'finance_manager')`,
 raw`INSERT INTO projects(id,company_id,name) VALUES(${project},${company},'Offer QA project'),(${otherProject},${company},'Other offer project')`,
 raw`INSERT INTO company_settings(company_id,currency,time_zone,locale) VALUES(${company},'EGP','Africa/Cairo','ar')`,
 ]);
 const account=await createAccount(fresh(),owner,{company_id:company,username:'offer-sales-'+tag,display_name:'Offer QA Sales',password:'Offer QA fixture password 2026!',email:'',role:'sales'},true),s1={userId:account.user_id,email:account.username};
 await raw.transaction([raw`INSERT INTO crm_sales_teams(id,company_id,name,manager_user_id) VALUES(${team},${company},'Offer QA team',${manager.userId})`,raw`INSERT INTO crm_sales_team_members(company_id,team_id,user_id) VALUES(${company},${team},${s1.userId})`]);
 for(let n=0;n<units.length;n++)await raw`INSERT INTO inventory_units(id,company_id,project_id,code,building,floor,category,area,proposed_price_minor) VALUES(${units[n]},${company},${project},${'OFFER-'+(n+1)},'A','1','Office',100,100000)`;
 const c1=await createCustomer(fresh(),s1,{company_id:company,full_name:'عميل اختبار العروض',phone:'+201001234567',email:''}),c2=await createCustomer(fresh(),s2,{company_id:company,full_name:'Colleague offer customer',phone:'+201001234568',email:''});
 await createLead(fresh(),s1,{company_id:company,customer_id:c1.id,source:'Offer QA',project_id:project});
 const req=(await createBuyerRequest(fresh(),s1,{company_id:company,customer_id:c1.id,project_id:project,unit_category:'Office'})).request;
 const req2=(await createBuyerRequest(fresh(),s2,{company_id:company,customer_id:c1.id,project_id:project})).request;
 const requestOther=(await createBuyerRequest(fresh(),s1,{company_id:company,customer_id:c1.id,project_id:otherProject})).request;
 const approve=async(price,revision)=>{const b=await savePriceBook(fresh(),admin,{company_id:company,project_id:project,version:0,name:'Offer price '+price,plans:[{code:'PAY',name:'Quarterly payment',down_payment_bps:2000,installments:4,interval_months:3,adjustment_bps:0}],prices:units.map(unit_id=>({unit_id,source_unit_version:1,price,plan_codes:['PAY']}))});await approvePriceBook(fresh(),admin,{company_id:company,project_id:project,id:b.id,version:b.version,expected_revision:revision});return (await raw`SELECT id FROM price_book_plans WHERE book_id=${b.id}`)[0].id;};
 let plan=await approve('1000.00',0);
 const objects=new Map(),storage={put:async(k,b)=>{objects.set(k,new Uint8Array(b));},get:async k=>{if(!objects.has(k))throw Error('missing');return new Uint8Array(objects.get(k));},remove:async k=>{objects.delete(k);}};
 const payload=(n=0,extra={})=>({company_id:company,project_id:project,unit_id:units[n],plan_id:plan,customer_id:c1.id,source_request_id:req.id,date:'2026-10-21',language:'ar',...extra});
 let first;
 await check('Issue a numbered original Arabic PDF with a customer and buyer request',async()=>{first=await issueSavedOffer(fresh(),s1,payload(),storage);const day=(await raw`SELECT to_char(now() AT TIME ZONE 'Africa/Cairo','YYYYMMDD') AS day`)[0].day;assert.ok(first.offer_number.startsWith('OFF-'+day+'-'));assert.ok(new TextDecoder().decode(first.bytes.slice(0,5))==='%PDF-');assert.equal(objects.size,1);});
 await check('Issue writes one audited record without creating a booking or reserving the unit',async()=>{const row=(await raw`SELECT status FROM inventory_units WHERE id=${units[0]}`)[0];assert.equal(row.status,'available');assert.equal((await raw`SELECT count(*)::int n FROM bookings WHERE company_id=${company}`)[0].n,0);assert.equal((await raw`SELECT count(*)::int n FROM audit_logs WHERE company_id=${company} AND action='offer.issued' AND after_data->>'id'=${first.id}`)[0].n,1);});
 await check('Download returns exactly the original bytes',async()=>assert.deepEqual((await downloadSavedOffer(fresh(),s1,company,first.id,storage)).bytes,first.bytes));
 await check('Offer details keep the exact customer, request, unit, plan and date',async()=>{const d=await savedOfferDetail(fresh(),s1,company,first.id);assert.equal(d.customer.id,c1.id);assert.equal(d.source_request_id,req.id);assert.equal(d.unit_id,units[0]);assert.equal(d.plan_id,plan);assert.equal(d.quote_date,'2026-10-21');assert.equal(d.can_book,true);});
 await check('Offer counts and rows use own salesperson scope',async()=>{assert.equal((await listSavedOffers(fresh(),s1,{company})).total,1);assert.equal((await listSavedOffers(fresh(),s2,{company})).total,0);});
 await check('Team manager can see its team offer',async()=>assert.equal((await listSavedOffers(fresh(),manager,{company})).rows[0].id,first.id));
 await check('Other salesperson cannot download a known offer identifier',()=>deny(()=>downloadSavedOffer(fresh(),s2,company,first.id,storage),'OFFER_UNAVAILABLE'));
 await check('Finance-only account cannot open the customer offer API',()=>deny(()=>listSavedOffers(fresh(),finance,{company})));
 await check('Cross-company identifiers cannot be used to read an offer',()=>deny(()=>savedOfferDetail(fresh(),s1,foreignCompany,first.id)));
 await check('Forged platform mode never bypasses company membership',()=>deny(()=>listSavedOffers(fresh(),s1,{company:foreignCompany},true)));
 await check('Project price deny hides rows, counts and direct download',async()=>{await setPermission(fresh(),admin,{company_id:company,user_id:s1.userId,project_id:project,action:'pricing.read',allowed:false});try{assert.equal((await listSavedOffers(fresh(),s1,{company})).total,0);await deny(()=>downloadSavedOffer(fresh(),s1,company,first.id,storage),'OFFER_UNAVAILABLE');}finally{await setPermission(fresh(),admin,{company_id:company,user_id:s1.userId,project_id:project,action:'pricing.read',allowed:true});}});
 await check('A colleague request cannot be attached to an own offer',()=>deny(()=>issueSavedOffer(fresh(),s1,payload(0,{source_request_id:req2.id}),storage),'INVALID_JOURNEY_SOURCE'));
 await check('A buyer request cannot cross project boundaries',()=>deny(()=>issueSavedOffer(fresh(),s1,payload(0,{source_request_id:requestOther.id}),storage),'INVALID_JOURNEY_SOURCE'));
 await check('A request cannot be attached to a different customer',()=>deny(()=>issueSavedOffer(fresh(),s1,payload(0,{customer_id:c2.id}),storage),'INVALID_JOURNEY_SOURCE'));
 await check('Caller-supplied prices and unknown fields are rejected',()=>assert.rejects(()=>issueSavedOffer(fresh(),s1,{...payload(),amount_minor:'1'},storage)));
 await check('Failed storage writes never become visible as saved offers',async()=>{await deny(()=>issueSavedOffer(fresh(),s1,payload(1),{...storage,put:async()=>{throw Error('unavailable');}}),'STORAGE_UNAVAILABLE');assert.equal((await listSavedOffers(fresh(),s1,{company})).total,1);assert.equal((await raw`SELECT count(*)::int n FROM sales_offers WHERE company_id=${company} AND status='failed'`)[0].n,1);});
 await check('Tampered PDF bytes fail integrity verification',async()=>{const key=(await raw`SELECT object_key FROM sales_offers WHERE id=${first.id}`)[0].object_key,bytes=objects.get(key);objects.set(key,new Uint8Array(bytes.length));try{await deny(()=>downloadSavedOffer(fresh(),s1,company,first.id,storage),'FILE_INTEGRITY');}finally{objects.set(key,bytes);}});
 await check('Ready offer snapshots cannot be rewritten even by a database writer',()=>assert.rejects(()=>raw`UPDATE sales_offers SET amount_minor=1 WHERE id=${first.id}`,e=>e.message==='OFFER_IMMUTABLE'));
 const bookingInput=(n,offer,extra={})=>({company_id:company,project_id:project,unit_id:units[n],plan_id:plan,customer_id:c1.id,customer_name:c1.full_name,customer_phone:c1.phone,date:'2026-10-21',reservation_amount:'200.00',source_offer_id:offer.id,source_request_id:req.id,...extra});
 await check('A source offer cannot be changed to another customer or unit',async()=>{await deny(()=>createBooking(fresh(),s1,bookingInput(1,first)),'INVALID_JOURNEY_SOURCE');await deny(()=>createBooking(fresh(),s1,bookingInput(0,first,{customer_id:c2.id})),'INVALID_JOURNEY_SOURCE');});
 let booking;
 await check('Booking preserves source offer and buyer request in immutable terms',async()=>{booking=(await createBooking(fresh(),s1,bookingInput(0,first))).booking;const b=(await raw`SELECT * FROM bookings WHERE id=${booking.id}`)[0];assert.equal(b.customer_id,c1.id);assert.equal(b.source_offer_id,first.id);assert.equal(b.source_request_id,req.id);assert.equal(b.quote_snapshot.source_offer_id,first.id);assert.equal(b.quote_snapshot.calculation.total_minor,'100000');});
 await check('Saved offer opens the existing authorized booking instead of duplicating it',async()=>{const d=await savedOfferDetail(fresh(),s1,company,first.id);assert.equal(d.can_book,false);assert.equal(d.linked_booking.id,booking.id);});
 await check('Booking source identifiers cannot disagree with frozen JSON terms',()=>assertBookingSourceGuard(raw,company,booking.id));
 await check('A booking source cannot be replaced after submission',()=>assert.rejects(()=>raw`UPDATE bookings SET source_offer_id=NULL WHERE id=${booking.id}`,e=>e.message==='BOOKING_SOURCE_IMMUTABLE'));
 const concurrent=await issueSavedOffer(fresh(),s1,payload(2),storage);
 await check('Concurrent attempts to book the same saved offer create one booking',async()=>{const r=await Promise.allSettled([createBooking(fresh(),s1,bookingInput(2,concurrent)),createBooking(fresh(),s1,bookingInput(2,concurrent))]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal((await raw`SELECT count(*)::int n FROM bookings WHERE company_id=${company} AND source_offer_id=${concurrent.id}`)[0].n,1);});
 const stale=await issueSavedOffer(fresh(),s1,payload(3),storage),oldPlan=plan;
 plan=await approve('2000.00',1);
 await check('New approved prices make old offers unavailable for new bookings',async()=>{const d=await savedOfferDetail(fresh(),s1,company,stale.id);assert.equal(d.price_current,false);assert.equal(d.can_book,false);await assert.rejects(()=>createBooking(fresh(),s1,bookingInput(3,stale,{plan_id:oldPlan})),e=>['PLAN_NOT_ALLOWED','PRICE_NOT_APPROVED','OFFER_PRICE_CHANGED'].includes(e.code));});
 await check('Historical PDF remains byte-identical after price and customer edits',async()=>{await raw`UPDATE crm_customers SET full_name='Updated contact name' WHERE id=${c1.id}`;assert.deepEqual((await downloadSavedOffer(fresh(),s1,company,first.id,storage)).bytes,first.bytes);assert.equal((await raw`SELECT snapshot->'customer'->>'full_name' AS name FROM sales_offers WHERE id=${first.id}`)[0].name,c1.full_name);});
 await check('Operations, Accounts and contract creation preserve the original customer and quote',async()=>{await updateBooking(fresh(),ops,{company_id:company,booking_id:booking.id},'approve');await updateBooking(fresh(),finance,{company_id:company,booking_id:booking.id,received_amount:'200.00'},'confirm_receipt');const c=(await createContract(fresh(),ops,{company_id:company,booking_id:booking.id,date:'2026-10-21'})).contract;const row=(await raw`SELECT customer_id,value_final_minor::text,payment_plan_snapshot FROM contracts WHERE id=${c.id}`)[0];assert.equal(row.customer_id,c1.id);assert.equal(row.value_final_minor,'100000');assert.equal(row.payment_plan_snapshot.source_offer_id,first.id);});
 await check('Customer 360 connects saved offers to the same customer after contracting',async()=>{const d=await customerJourney(fresh(),admin,{company,customer:c1.id,tab:'offers'});assert.ok(d.rows.some(o=>o.id===first.id));assert.equal(d.counts.contracts,1);});
 await check('Tenant binding keeps unfiltered offer SQL inside one company',async()=>{const sql=fresh();await listSavedOffers(sql,s1,{company});assert.deepEqual((await sql`SELECT DISTINCT company_id FROM sales_offers`).map(r=>r.company_id),[company]);});
 await check('Pagination rejects invalid page and record filters',async()=>{for(const invalid of [{page:-1},{page:0.5},{customer:'invalid'}])await assert.rejects(()=>listSavedOffers(fresh(),s1,{company,...invalid}));});
 const purgeCompanyId=crypto.randomUUID(),purgeProject=crypto.randomUUID(),purgeUnit=crypto.randomUUID();
 await raw.transaction([raw`INSERT INTO companies(id,name,account_limit) VALUES(${purgeCompanyId},'Offer QA purge',5)`,raw`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${purgeCompanyId},${admin.userId},${admin.email},'company_admin')`,raw`INSERT INTO projects(id,company_id,name) VALUES(${purgeProject},${purgeCompanyId},'Purge test')`,raw`INSERT INTO inventory_units(id,company_id,project_id,code,building,floor,category,area,proposed_price_minor) VALUES(${purgeUnit},${purgeCompanyId},${purgeProject},'PURGE-OFFER','A','1','Office',100,100000)`]);
 const purgeBook=await savePriceBook(fresh(),admin,{company_id:purgeCompanyId,project_id:purgeProject,version:0,name:'Purge prices',plans:[{code:'PAY',name:'Cash',down_payment_bps:10000,installments:0,interval_months:1,adjustment_bps:0}],prices:[{unit_id:purgeUnit,source_unit_version:1,price:'1000.00',plan_codes:['PAY']}]});await approvePriceBook(fresh(),admin,{company_id:purgeCompanyId,project_id:purgeProject,id:purgeBook.id,version:purgeBook.version,expected_revision:0});
 const pp=(await raw`SELECT id FROM price_book_plans WHERE book_id=${purgeBook.id}`)[0].id;
 const po=await issueSavedOffer(fresh(),admin,{company_id:purgeCompanyId,project_id:purgeProject,unit_id:purgeUnit,plan_id:pp,date:'2026-10-21',language:'en'},storage),purgeKey=(await raw`SELECT object_key FROM sales_offers WHERE id=${po.id}`)[0].object_key;
 await raw`UPDATE companies SET status='deleted',previous_status='active',deleted_at=now(),purge_after=now()-interval '1 second' WHERE id=${purgeCompanyId}`;
 await check('Company retention purge queues and removes saved offer PDFs and records',async()=>{await purgeCompany(fresh(),owner,{id:purgeCompanyId,version:1,confirm:'Offer QA purge'},storage);assert.equal((await raw`SELECT count(*)::int n FROM sales_offers WHERE company_id=${purgeCompanyId}`)[0].n,0);assert.equal(objects.has(purgeKey),false);});
 const latest=await issueSavedOffer(fresh(),s1,payload(4),storage);
 return {passed:checks.length,checks,fixture:{company,project,customer:c1.id,request:req.id,offer:latest.id,original_offer:first.id,unit:units[4],plan,username:account.username},pdf:first.bytes};
}

export async function assertBookingSourceGuard(raw,company,booking){
 assert.equal((await raw`SELECT user_id FROM platform_owner`)[0]?.user_id,'identity-test-platform-owner','DEV only');
 await assert.rejects(()=>raw`INSERT INTO bookings(company_id,project_id,unit_id,customer_id,book_id,plan_id,customer_name,customer_phone,requested_amount_minor,reservation_amount_minor,sales_user_id,quote_snapshot,source_offer_id,source_request_id) SELECT company_id,project_id,unit_id,customer_id,book_id,plan_id,customer_name,customer_phone,requested_amount_minor,reservation_amount_minor,sales_user_id,quote_snapshot-'source_offer_id',source_offer_id,source_request_id FROM bookings WHERE company_id=${company} AND id=${booking}`,e=>e.message==='INVALID_JOURNEY_SOURCE');
 const another=(await raw`SELECT id FROM inventory_units WHERE company_id=${company} AND id<>(SELECT unit_id FROM bookings WHERE company_id=${company} AND id=${booking}) ORDER BY code LIMIT 1`)[0];
 await assert.rejects(()=>raw`UPDATE bookings SET unit_id=${another.id} WHERE company_id=${company} AND id=${booking}`,e=>e.message==='BOOKING_SOURCE_IMMUTABLE');
}
