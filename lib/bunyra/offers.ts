import {z} from 'zod';
import {ServiceError,uuid,type Sql,type Actor} from './service';
import {offerScope,requireOffer,requireBuyerSource} from './offer-scope';
import {createOffer} from './commercial';
import {renderOfferPdf} from './offer-pdf';
import {projectAllowed} from './record-scope';
import {unitPricing} from './pricing';
import type {PlanStorage} from './plan-files';

export const savedOfferInput=z.object({company_id:uuid,project_id:uuid,unit_id:uuid,plan_id:uuid,customer_id:uuid.nullable().optional(),source_request_id:uuid.nullable().optional(),date:z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),language:z.enum(['ar','en']).default('ar')}).strict();
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),b=>b.toString(16).padStart(2,'0')).join('');
export async function issueSavedOffer(sql:Sql,actor:Actor,input:unknown,storage:PlanStorage,platform=false){
 const c=savedOfferInput.parse(input),{source_request_id,...quoteInput}=c;
 await offerScope(sql,actor,c.company_id,platform);
 if(source_request_id){if(!c.customer_id)throw new ServiceError('INVALID_JOURNEY_SOURCE',400);await requireBuyerSource(sql,actor,c.company_id,source_request_id,c.customer_id,c.project_id,platform);}
 const offer=await createOffer(sql,actor,quoteInput,platform);
 if(c.customer_id&&!offer.customer)throw new ServiceError('INVALID_CUSTOMER',400);
 const day=(await sql`SELECT to_char(now() AT TIME ZONE COALESCE((SELECT time_zone FROM company_settings WHERE company_id=${c.company_id}),'Africa/Cairo'),'YYYYMMDD') AS day`)[0].day;
 const id=crypto.randomUUID(),number='OFF-'+day+'-'+id.slice(0,8).toUpperCase();
 const snapshot={...offer,reference:number},bytes=renderOfferPdf(snapshot as unknown as Parameters<typeof renderOfferPdf>[0]);
 if(bytes.length>5242880)throw new ServiceError('OFFER_TOO_LARGE',413);
 const key=c.company_id+'/offers/'+id+'.pdf',sha=await hash(bytes);
 const rows=await sql`INSERT INTO sales_offers(id,company_id,project_id,unit_id,customer_id,source_request_id,book_id,plan_id,source_unit_version,offer_number,quote_date,language,amount_minor,currency,snapshot,object_key,byte_size,sha256,created_by)
 SELECT ${id},${c.company_id},${c.project_id},${c.unit_id},${c.customer_id||null}::uuid,${source_request_id||null}::uuid,${offer.quote.book?.id},${c.plan_id},${offer.quote.source_unit_version},${number},${c.date}::date,${c.language},${offer.quote.calculation.total_minor}::bigint,${offer.quote.book?.currency},${JSON.stringify(snapshot)}::jsonb,${key},${bytes.length},${sha},${actor.userId}
 WHERE EXISTS(SELECT 1 FROM inventory_units u JOIN project_pricing p ON p.company_id=u.company_id AND p.project_id=u.project_id WHERE u.company_id=${c.company_id} AND u.id=${c.unit_id} AND u.project_id=${c.project_id} AND u.active AND u.status='available' AND u.version=${offer.quote.source_unit_version} AND p.book_id=${offer.quote.book?.id}) RETURNING id`;
 if(!rows.length)throw new ServiceError('OFFER_PRICE_CHANGED',409);
 try{await storage.put(key,bytes,'application/pdf');}catch{await sql`UPDATE sales_offers SET status='failed' WHERE company_id=${c.company_id} AND id=${id} AND status='uploading'`;throw new ServiceError('STORAGE_UNAVAILABLE',503);}
 await sql`WITH changed AS(UPDATE sales_offers SET status='ready' WHERE company_id=${c.company_id} AND id=${id} AND status='uploading' RETURNING id,offer_number,customer_id,source_request_id,unit_id),logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'offer.issued',to_jsonb(changed) FROM changed) SELECT id FROM changed`;
 return {id,offer_number:number,bytes};
}
export async function downloadSavedOffer(sql:Sql,actor:Actor,company:string,id:string,storage:PlanStorage,platform=false){
 const row=await requireOffer(sql,actor,company,id,platform),bytes=await storage.get(row.object_key);
 if(bytes.length!==row.byte_size||await hash(bytes)!==row.sha256)throw new ServiceError('FILE_INTEGRITY',503);
 return {bytes,name:row.offer_number+'.pdf'};
}
export async function savedOfferDetail(sql:Sql,actor:Actor,company:string,id:string,platform=false){
 const row=await requireOffer(sql,actor,company,id,platform),scope=await offerScope(sql,actor,company,platform);
 const customer=row.customer_id?(await sql`SELECT id,full_name,phone,email,address FROM crm_customers WHERE company_id=${company} AND id=${row.customer_id}`)[0]:null;
 const current=await unitPricing(sql,actor,company,row.project_id,row.unit_id,platform);
 const valid=current.approved&&current.book?.id===row.book_id&&current.unit.version===row.source_unit_version&&current.unit.status==='available'&&current.plans?.some(p=>p.id===row.plan_id);
 const activeBooking=(await sql`SELECT id,sales_user_id,status FROM bookings WHERE company_id=${company} AND unit_id=${row.unit_id} AND status IN('submitted','approved','accounts_pending','accounts_confirmed') ORDER BY created_at DESC LIMIT 1`)[0];
 const canReadBooking=projectAllowed(scope.ctx,'bookings.read')&&projectAllowed(scope.ctx,'bookings.read',row.project_id)&&(!scope.users||scope.users.includes(activeBooking?.sales_user_id));
 const canBook=!activeBooking&&!!valid&&!!customer&&projectAllowed(scope.ctx,'bookings.read')&&projectAllowed(scope.ctx,'bookings.read',row.project_id)&&projectAllowed(scope.ctx,'bookings.create')&&projectAllowed(scope.ctx,'bookings.create',row.project_id)&&(scope.ctx.owner||['company_admin','sales','sales_manager','sales_admin'].includes(scope.ctx.role));
 return {id:row.id,offer_number:row.offer_number,company_id:company,project_id:row.project_id,unit_id:row.unit_id,plan_id:row.plan_id,source_request_id:row.source_request_id,quote_date:row.issued_date,customer,issued_customer_name:row.snapshot.customer?.full_name||null,unit:row.snapshot.unit,project:row.snapshot.project,quote:row.snapshot.quote,can_book:canBook,price_current:!!valid,unit_available:!activeBooking,linked_booking:activeBooking&&canReadBooking?{id:activeBooking.id,status:activeBooking.status}:null};
}
export async function listSavedOffers(sql:Sql,actor:Actor,input:unknown,platform=false){
 const q=z.object({company:uuid,customer:uuid.optional(),request:uuid.optional(),page:z.coerce.number().int().min(0).max(10000).default(0)}).parse(input),s=await offerScope(sql,actor,q.company,platform);
 const params=[q.company,s.projects,s.users,q.customer||null,q.request||null];
 const where=`o.company_id=$1::uuid AND o.status='ready' AND o.project_id=ANY($2::uuid[]) AND ($3::text[] IS NULL OR o.created_by=ANY($3::text[])) AND ($4::uuid IS NULL OR o.customer_id=$4::uuid) AND ($5::uuid IS NULL OR o.source_request_id=$5::uuid)`;
 const [rows,total]=await Promise.all([sql.query(`SELECT o.id,o.offer_number,o.customer_id,o.source_request_id,o.project_id,o.unit_id,o.plan_id,o.quote_date::text,o.amount_minor::text,o.currency,o.created_at,o.snapshot->'unit'->>'code' AS unit_code,o.snapshot->'customer'->>'full_name' AS customer_name FROM sales_offers o WHERE ${where} ORDER BY o.created_at DESC,o.id LIMIT 20 OFFSET $6::int`,[...params,q.page*20]),sql.query(`SELECT count(*)::int AS total FROM sales_offers o WHERE ${where}`,params)]);
 return {rows,total:total[0].total,page:q.page,page_size:20};
}
