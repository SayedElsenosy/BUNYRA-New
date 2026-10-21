import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {hasPermission,type Action} from './permissions';
import {salesScope} from './record-scope';

export const hubQuery=z.object({
 company:uuid,kind:z.enum(['overview','tasks','search','record']).default('overview'),
 q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(0).max(10000).default(0),
 bucket:z.enum(['all','overdue','today','tomorrow','waiting']).default('all'),
 entity:z.enum(['all','customer','unit','booking','contract']).default('all'),id:uuid.optional(),
});
type Query=z.infer<typeof hubQuery>;
export const completeInput=z.object({company_id:uuid,id:uuid,operation:z.literal('complete_follow_up')}).strict();
const size=20;

// Keep the scope in SQL, before counts, pagination, or any record leaves the server.
async function context(sql:Sql,actor:Actor,company:string,platform:boolean,crmAction:Action='leads.read'){
 const ctx=await access(sql,actor,company,'company.read',platform);
 const users=await salesScope(sql,actor,company,ctx);
 const can=(action:Action)=>ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,action);
 const projects=await sql`SELECT id FROM projects WHERE company_id=${company}`;
 const permitted=(action:Action)=>can(action)?projects.filter(p=>ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,action,p.id)).map(p=>p.id):[];
 const readProjects=permitted('projects.read');
 const intersect=(a:unknown[],b:unknown[])=>a.filter(id=>b.includes(id));
 const bookings=permitted('bookings.read');
 const inventoryProjects=intersect(permitted('inventory.read'),readProjects);
 const settings=(await sql`SELECT now() AS current_time,COALESCE((SELECT time_zone FROM company_settings WHERE company_id=${company}),'Africa/Cairo') AS time_zone`)[0];
 const financeUsers=ctx.role==='sales_admin'&&!ctx.owner?[actor.userId]:users;
 const leadProjects=crmAction==='leads.write'?intersect(permitted(crmAction),permitted('leads.read')):permitted(crmAction);
 return {ctx,can,inventoryVisible:can('inventory.read')&&can('projects.read')&&(!projects.length||inventoryProjects.length>0),params:[company,users,leadProjects,inventoryProjects,bookings,
  intersect(permitted('finance.read'),bookings),intersect(permitted('bookings.approve'),bookings),intersect(permitted('finance.write'),bookings),
  can(crmAction),can('inventory.read')&&can('projects.read'),can('bookings.read'),can('finance.read')&&can('bookings.read'),
  settings.time_zone,settings.current_time,financeUsers],timeZone:String(settings.time_zone),now:settings.current_time};
}

const scopes=`WITH visible_units AS (
 SELECT u.* FROM inventory_units u WHERE u.company_id=$1::uuid AND $10::boolean
 AND u.project_id=ANY($4::uuid[]) AND u.active
), visible_leads AS (
 SELECT l.* FROM crm_leads l WHERE l.company_id=$1::uuid AND $9::boolean
 AND ($2::text[] IS NULL OR l.owner_user_id=ANY($2::text[]))
 AND (l.project_id IS NULL OR l.project_id=ANY($3::uuid[]))
), visible_customers AS (
 SELECT c.* FROM crm_customers c WHERE c.company_id=$1::uuid AND $9::boolean AND (
 EXISTS(SELECT 1 FROM visible_leads l WHERE l.customer_id=c.id)
 OR (NOT EXISTS(SELECT 1 FROM crm_leads l WHERE l.company_id=c.company_id AND l.customer_id=c.id)
 AND ($2::text[] IS NULL OR c.created_by=ANY($2::text[]))))
), visible_followups AS (
 SELECT f.*,c.full_name,m.email AS assignee FROM crm_follow_ups f
 JOIN crm_customers c ON c.company_id=f.company_id AND c.id=f.customer_id
 LEFT JOIN memberships m ON m.company_id=f.company_id AND m.user_id=f.assigned_to
 WHERE f.company_id=$1::uuid AND $9::boolean AND f.status='open'
 AND ($2::text[] IS NULL OR f.assigned_to=ANY($2::text[]))
 AND (f.lead_id IS NULL OR EXISTS(SELECT 1 FROM visible_leads l WHERE l.id=f.lead_id))
), visible_bookings AS (
 SELECT b.*,u.code AS unit_code,p.name AS project_name FROM bookings b
 JOIN inventory_units u ON u.company_id=b.company_id AND u.id=b.unit_id
 JOIN projects p ON p.company_id=b.company_id AND p.id=b.project_id
 WHERE b.company_id=$1::uuid AND $11::boolean AND b.project_id=ANY($5::uuid[])
 AND ($2::text[] IS NULL OR b.sales_user_id=ANY($2::text[]))
), visible_contracts AS (
 SELECT c.*,b.customer_name,b.unit_code FROM contracts c JOIN visible_bookings b ON b.id=c.booking_id
 WHERE c.company_id=$1::uuid AND $12::boolean AND c.project_id=ANY($6::uuid[])
 AND ($15::text[] IS NULL OR b.sales_user_id=ANY($15::text[]))
), tasks AS (
 SELECT f.id,'follow_up'::text AS kind,f.title,f.full_name AS context,f.due_at,f.created_at,
 f.assigned_to AS assignee_id,COALESCE(f.assignee,'') AS assignee,'customers'::text AS view,f.customer_id AS record_id,
 CASE WHEN f.due_at<$14::timestamptz THEN 'overdue'
 WHEN (f.due_at AT TIME ZONE $13::text)::date=($14::timestamptz AT TIME ZONE $13::text)::date THEN 'today'
 WHEN (f.due_at AT TIME ZONE $13::text)::date=($14::timestamptz AT TIME ZONE $13::text)::date+1 THEN 'tomorrow' ELSE 'later' END AS bucket
 FROM visible_followups f
 UNION ALL
 SELECT b.id,'booking_approval','',b.customer_name||' · '||b.unit_code,NULL::timestamptz,b.created_at,NULL::text,''::text,'bookings',b.id,'waiting'
 FROM visible_bookings b WHERE b.status='submitted' AND b.project_id=ANY($7::uuid[])
 UNION ALL
 SELECT b.id,'receipt_confirmation','',b.customer_name||' · '||b.unit_code,NULL::timestamptz,b.created_at,NULL::text,''::text,'bookings',b.id,'waiting'
 FROM visible_bookings b WHERE b.status IN('approved','accounts_pending') AND b.project_id=ANY($8::uuid[])
 AND ($15::text[] IS NULL OR b.sales_user_id=ANY($15::text[]))
 UNION ALL
 SELECT i.id,'installment',c.contract_number||' · #'||i.number::text,c.customer_name,
 ((i.due_date+1)::timestamp AT TIME ZONE $13::text)-interval '1 microsecond',i.created_at,NULL::text,''::text,'collections',c.id,
 CASE WHEN i.due_date<($14::timestamptz AT TIME ZONE $13::text)::date THEN 'overdue'
 WHEN i.due_date=($14::timestamptz AT TIME ZONE $13::text)::date THEN 'today' ELSE 'tomorrow' END
 FROM contract_installments i JOIN visible_contracts c ON c.id=i.contract_id
 WHERE i.company_id=$1::uuid AND c.status='active' AND i.status IN('due','partial') AND i.amount_minor>i.paid_minor
 AND i.due_date<=($14::timestamptz AT TIME ZONE $13::text)::date+1
)`;

const taskSummary=`SELECT count(*)::int AS total,count(*) FILTER(WHERE bucket='overdue')::int AS overdue,
 count(*) FILTER(WHERE bucket='today')::int AS today,count(*) FILTER(WHERE bucket='tomorrow')::int AS tomorrow,
 count(*) FILTER(WHERE bucket='waiting')::int AS waiting FROM tasks`;

export async function workspaceHub(sql:Sql,actor:Actor,input:unknown,platform=false){
 const q=hubQuery.parse(input),scope=await context(sql,actor,q.company,platform),p=scope.params;
 const capabilities={crm:scope.can('leads.read'),write_crm:scope.can('leads.read')&&scope.can('leads.write'),
  inventory:scope.inventoryVisible,bookings:scope.can('bookings.read'),finance:scope.can('finance.read')&&scope.can('bookings.read')};
 const meta={role:scope.ctx.role,owner:scope.ctx.owner,time_zone:scope.timeZone,as_of:scope.now,capabilities};
 if(q.kind==='overview'){
  const rows=await sql.query(scopes+` SELECT
   (SELECT count(*)::int FROM visible_leads WHERE status NOT IN('won','lost')) AS open_leads,
   (SELECT count(*)::int FROM visible_customers) AS customers,
   (SELECT count(*)::int FROM visible_units WHERE status='available') AS available_units,
   (SELECT count(*)::int FROM visible_bookings WHERE status='submitted') AS pending_bookings,
   (SELECT count(*)::int FROM visible_contracts WHERE status='active') AS active_contracts,
   (SELECT json_build_object('total',count(*)::int,'overdue',count(*) FILTER(WHERE bucket='overdue')::int,
    'today',count(*) FILTER(WHERE bucket='today')::int,'tomorrow',count(*) FILTER(WHERE bucket='tomorrow')::int,
    'waiting',count(*) FILTER(WHERE bucket='waiting')::int) FROM tasks) AS work`,p);
  // All counts below use the same scope; no capped list is used as a KPI.
  return {...meta,metrics:rows[0]};
 }
 if(q.kind==='tasks'){
  const summary=await sql.query(scopes+' '+taskSummary,p);
  const rows=await sql.query(scopes+` SELECT *,count(*) OVER()::int AS filtered_total FROM tasks
   WHERE ($16::text='all' OR bucket=$16::text)
   ORDER BY CASE bucket WHEN 'overdue' THEN 0 WHEN 'today' THEN 1 WHEN 'waiting' THEN 2 WHEN 'tomorrow' THEN 3 ELSE 4 END,due_at NULLS LAST,created_at,id,kind LIMIT 20 OFFSET $17::int`,[...p,q.bucket,q.page*size]);
  const filtered=q.bucket==='all'?summary[0].total:summary[0][q.bucket];
  return {...meta,items:rows.map(({filtered_total,...r})=>r),summary:summary[0],total:Number(filtered||0),page:q.page,page_size:size};
 }
 return {...meta,...await search(sql,q,p)};
}

function cleanQuery(q:string){return q.normalize('NFKC').replace(/[٠-٩]/g,v=>String(v.charCodeAt(0)-1632)).replace(/[۰-۹]/g,v=>String(v.charCodeAt(0)-1776)).trim();}
async function search(sql:Sql,q:Query,p:unknown[]){
 const term=cleanQuery(q.q);
 if(q.kind==='record'&&(!q.id||q.entity==='all'))throw new ServiceError('VALIDATION_ERROR',400);
 if(q.kind!=='record'&&term.length<2)return {items:[],total:0,page:q.page,page_size:size};
 const query=scopes+`, records AS (
 SELECT c.id,'customer'::text AS kind,c.full_name AS title,c.phone AS subtitle,''::text AS status,NULL::uuid AS project_id,c.id AS customer_id,
 concat_ws(' ',c.full_name,c.phone,c.normalized_phone,c.email) AS search_text,
 jsonb_build_object('phone',c.phone,'email',c.email,'address',c.address) AS details FROM visible_customers c
 UNION ALL
 SELECT u.id,'unit',u.code,p.name||' · '||u.building||' / '||u.floor,u.status,u.project_id,NULL::uuid,
 concat_ws(' ',u.code,p.name,u.building,u.floor,u.category),jsonb_build_object('building',u.building,'floor',u.floor,'category',u.category,'area',u.area::text)
 FROM visible_units u JOIN projects p ON p.company_id=u.company_id AND p.id=u.project_id
 UNION ALL
 SELECT b.id,'booking',b.unit_code||' · '||b.customer_name,b.project_name,b.status,b.project_id,b.customer_id,
 concat_ws(' ',b.unit_code,b.customer_name,b.customer_phone,b.id::text),jsonb_build_object('created_at',b.created_at,'phone',b.customer_phone)
 FROM visible_bookings b
 UNION ALL
 SELECT c.id,'contract',c.contract_number,c.customer_name||' · '||c.unit_code,c.status,c.project_id,c.customer_id,
 concat_ws(' ',c.contract_number,c.customer_name,c.unit_code,c.id::text),jsonb_build_object('value_minor',c.value_final_minor::text,'currency',c.commission_currency,'signed_at',c.signed_at)
 FROM visible_contracts c
), matched AS (SELECT * FROM records WHERE
 ($16::text='all' OR kind=$16::text) AND
 CASE WHEN $17::uuid IS NOT NULL THEN id=$17::uuid ELSE strpos(lower(search_text),lower($18::text))>0 END
), page AS (SELECT id,kind,title,subtitle,status,project_id,customer_id,details FROM matched ORDER BY kind,title,id LIMIT 20 OFFSET $19::int)
 SELECT COALESCE((SELECT jsonb_agg(page ORDER BY kind,title,id) FROM page),'[]'::jsonb) AS items,(SELECT count(*)::int FROM matched) AS total`;
 const rows=await sql.query(query,[...p,q.entity,q.kind==='record'?q.id:null,term,q.page*size]);
 if(q.kind==='record'&&!rows[0].total)throw new ServiceError('NOT_FOUND',404);
 return {...rows[0],page:q.page,page_size:size};
}

export async function completeWorkItem(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=completeInput.parse(input),scope=await context(sql,actor,c.company_id,platform,'leads.write');
 if(!scope.can('leads.read')||!scope.can('leads.write'))throw new ServiceError('FORBIDDEN',403);
 const rows=await sql.query(scopes+`, changed AS (
 UPDATE crm_follow_ups f SET status='done',completed_at=now() WHERE f.company_id=$1::uuid AND f.id=$16::uuid
 AND f.status='open' AND EXISTS(SELECT 1 FROM visible_followups v WHERE v.id=f.id) RETURNING f.*
 ), logged AS (INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 SELECT $1::uuid,$17::text,$18::text,'crm.follow_up_updated',to_jsonb(changed) FROM changed)
 SELECT id,status FROM changed`,[...scope.params,c.id,actor.userId,actor.email]);
 if(!rows.length)throw new ServiceError('WORK_ITEM_UNAVAILABLE',409);
 return rows[0];
}

// Shared authorized task source for the in-app alert inbox.
// Task visibility remains defined once, in the Workspace scope CTE.
export {context as workspaceTaskContext,scopes as workspaceTaskSql};
