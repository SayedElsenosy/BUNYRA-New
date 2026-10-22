import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {salesScope,projectAllowed} from './record-scope';
import type {Action} from './permissions';

export const journeyQuery=z.object({company:uuid,customer:uuid,tab:z.enum(['activity','leads','followups','requests','offers','bookings','contracts','collections']).default('activity'),page:z.coerce.number().int().min(0).max(10000).default(0)});
const size=20;

// Contacts remain a shared company directory. Every related record has its own
// action, project and salesperson scope before aggregation or pagination.
export async function customerJourney(sql:Sql,actor:Actor,input:unknown,platform=false){
 const q=journeyQuery.parse(input),ctx=await access(sql,actor,q.company,'leads.read',platform);
 const customer=(await sql`SELECT id,full_name,phone,email,address,notes,created_at,updated_at FROM crm_customers WHERE company_id=${q.company} AND id=${q.customer}`)[0];
 if(!customer)throw new ServiceError('NOT_FOUND',404);
 const timeZone=(await sql`SELECT time_zone FROM company_settings WHERE company_id=${q.company}`)[0]?.time_zone||'Africa/Cairo';
 const users=await salesScope(sql,actor,q.company,ctx);
 const projects=await sql`SELECT id FROM projects WHERE company_id=${q.company}`;
 const can=(action:Action)=>projectAllowed(ctx,action);
 const permitted=(action:Action)=>can(action)?projects.filter(p=>projectAllowed(ctx,action,p.id)).map(p=>p.id):[];
 const leadProjects=permitted('leads.read'),bookProjects=permitted('bookings.read');
 const financeProjects=permitted('finance.read').filter(id=>bookProjects.includes(id));
 const offerProjects=permitted('pricing.read').filter(id=>permitted('inventory.read').includes(id)&&permitted('projects.read').includes(id));
 const tabs=['activity','leads','followups','requests',...(offerProjects.length?['offers']:[]),...(can('bookings.read')?['bookings']:[]),...(can('bookings.read')&&can('finance.read')?['contracts','collections']:[])];
 if(!tabs.includes(q.tab))throw new ServiceError('FORBIDDEN',403);
 const params=[q.company,q.customer,users,leadProjects,bookProjects,financeProjects,ctx.role==='sales_admin'&&!ctx.owner?[actor.userId]:users,offerProjects];
 const ctes=`WITH leads AS (
 SELECT l.* FROM crm_leads l WHERE l.company_id=$1::uuid AND l.customer_id=$2::uuid
 AND ($3::text[] IS NULL OR l.owner_user_id=ANY($3::text[])) AND (l.project_id IS NULL OR l.project_id=ANY($4::uuid[]))
 ), interactions AS (
 SELECT i.* FROM crm_interactions i WHERE i.company_id=$1 AND i.customer_id=$2
 AND (i.lead_id IN(SELECT id FROM leads) OR (i.lead_id IS NULL AND ($3::text[] IS NULL OR i.created_by=ANY($3::text[]) OR EXISTS(SELECT 1 FROM leads l JOIN crm_lead_transfers h ON h.company_id=l.company_id AND h.lead_id=l.id AND h.to_user_id=l.owner_user_id))))
 ), followups AS (
 SELECT f.* FROM crm_follow_ups f WHERE f.company_id=$1 AND f.customer_id=$2 AND ($3::text[] IS NULL OR f.assigned_to=ANY($3::text[]))
 AND (f.lead_id IS NULL OR f.lead_id IN(SELECT id FROM leads))
 ), requests AS (
 SELECT r.* FROM buyer_requests r WHERE r.company_id=$1 AND r.customer_id=$2 AND ($3::text[] IS NULL OR r.created_by=ANY($3::text[]))
 AND (r.project_id IS NULL OR r.project_id=ANY($4::uuid[]))
 ), bookings AS (
 SELECT b.* FROM public.bookings b WHERE b.company_id=$1 AND b.customer_id=$2 AND b.project_id=ANY($5::uuid[])
 AND ($3::text[] IS NULL OR b.sales_user_id=ANY($3::text[]))
 ), contracts AS (
 SELECT c.* FROM public.contracts c JOIN bookings b ON b.id=c.booking_id WHERE c.company_id=$1 AND c.customer_id=$2
 AND c.project_id=ANY($6::uuid[]) AND ($7::text[] IS NULL OR b.sales_user_id=ANY($7::text[]))
 ), offers AS (
 SELECT o.* FROM sales_offers o WHERE o.company_id=$1 AND o.customer_id=$2 AND o.status='ready' AND o.project_id=ANY($8::uuid[]) AND ($3::text[] IS NULL OR o.created_by=ANY($3::text[]))
 ), records AS (
 SELECT 'leads' AS section,l.id,'lead' AS kind,l.stage_code AS title,l.interest AS body,l.stage_code AS status,l.created_at AS at,
 'pipeline' AS view,l.id AS record,jsonb_build_object('source',l.source,'owner',m.email,'project',p.name) AS extra
 FROM leads l LEFT JOIN memberships m ON m.company_id=l.company_id AND m.user_id=l.owner_user_id LEFT JOIN projects p ON p.company_id=l.company_id AND p.id=l.project_id
 UNION ALL SELECT 'activity',i.id,i.kind,i.kind,i.body,''::text,i.created_at,'customers',i.customer_id,'{}'::jsonb FROM interactions i
 UNION ALL SELECT 'followups',f.id,'followup',f.title,'',f.status,f.due_at,'followups',f.id,jsonb_build_object('assigned_to',m.email) FROM followups f LEFT JOIN memberships m ON m.company_id=f.company_id AND m.user_id=f.assigned_to
 UNION ALL SELECT 'requests',r.id,'request',COALESCE(p.name,''),r.notes,r.status,r.created_at,'buyers',r.id,jsonb_build_object('category',r.unit_category,'min_area',r.min_area::text,'max_area',r.max_area::text,'payment_plan',r.payment_plan_code) FROM requests r LEFT JOIN projects p ON p.company_id=r.company_id AND p.id=r.project_id
 UNION ALL SELECT 'offers',o.id,'offer',o.offer_number,o.snapshot->'unit'->>'code','',o.created_at,'offers',o.id,jsonb_build_object('amount_minor',o.amount_minor::text,'currency',o.currency) FROM offers o
 UNION ALL SELECT 'bookings',b.id,'booking',u.code,p.name,b.status,b.created_at,'bookings',b.id,'{}'::jsonb FROM bookings b JOIN inventory_units u ON u.company_id=b.company_id AND u.id=b.unit_id JOIN projects p ON p.company_id=b.company_id AND p.id=b.project_id
 UNION ALL SELECT 'contracts',c.id,'contract',c.contract_number,u.code,c.status,c.signed_at,'contracts',c.id,jsonb_build_object('amount_minor',c.value_final_minor::text,'currency',c.commission_currency) FROM contracts c JOIN inventory_units u ON u.company_id=c.company_id AND u.id=c.unit_id
 UNION ALL SELECT 'collections',r.id,'collection',c.contract_number,r.reference,r.status,r.received_at,'receipts',c.id,jsonb_build_object('amount_minor',r.amount_minor::text,'currency',c.commission_currency) FROM public.collections r JOIN contracts c ON c.company_id=r.company_id AND c.id=r.contract_id WHERE r.company_id=$1
 ), timeline AS (
 SELECT * FROM records UNION ALL SELECT 'activity',r.id,r.kind,r.title,r.body,r.status,CASE WHEN r.kind='followup' THEN (SELECT f.created_at FROM followups f WHERE f.id=r.id) ELSE r.at END,r.view,r.record,r.extra FROM records r WHERE r.section<>'activity'
 )`;
 const [counts,rows]=await Promise.all([
  sql.query(ctes+` SELECT section,count(*)::int AS total FROM timeline GROUP BY section`,params),
  sql.query(ctes+` SELECT * FROM timeline WHERE section=$9::text ORDER BY at DESC,id,kind LIMIT ${size} OFFSET $10::int`,[...params,q.tab,q.page*size]),
 ]);
 return {customer,time_zone:timeZone,tabs,counts:Object.fromEntries(counts.map(r=>[r.section,r.total])),rows,page:q.page,page_size:size,can_write:can('leads.write'),can_request:can('leads.write')&&(ctx.owner||['company_admin','sales','sales_manager','sales_admin'].includes(ctx.role))};
}
