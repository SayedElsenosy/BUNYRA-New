import {z} from 'zod';
import {uuid,ServiceError,type Sql,type Actor} from './service';
import {projectAllowed} from './record-scope';
import {reportScope,scopeFilters,dateValue} from './report-scope';
const query=z.object({project:uuid.optional(),user:z.string().max(200).optional(),from:z.string().refine(dateValue),to:z.string().refine(dateValue),group:z.enum(['day','week','month']).default('day'),booking_status:z.enum(['all','submitted','approved','accounts_pending','accounts_confirmed','rejected','cancelled']).default('all'),contract_status:z.enum(['all','active','cancelled','completed']).default('all') ,page:z.coerce.number().int().min(0).max(10000).default(0)}).strict();
export async function salesReports(sql:Sql,actor:Actor,company:string,input:unknown,platform=false){
 const f=query.parse(input);if(f.from>f.to||(Date.parse(f.to)-Date.parse(f.from))/86400000>366)throw new ServiceError('INVALID_DATE_RANGE');
 const scope=await reportScope(sql,actor,company,'reports.read',platform),selected=scopeFilters(scope,f.project,f.user);
 const commissionProjects=selected.projects.filter(p=>projectAllowed(scope.ctx,'commissions.read',p));
 const zone=(await sql`SELECT time_zone FROM company_settings WHERE company_id=${company}`)[0]?.time_zone||'Africa/Cairo';
 // Aggregate events before joining: one interaction or contract contributes once,
 // even if a customer has several leads. No offer PDFs are counted as sales.
 const result=await sql`WITH visible_leads AS(
 SELECT id,project_id,owner_user_id FROM crm_leads WHERE company_id=${company}
 AND (project_id=ANY(${selected.projects}::uuid[]) OR (project_id IS NULL AND ${!f.project}))

 ), visible_contracts AS(
 SELECT * FROM commission_balances c WHERE c.company_id=${company} AND c.project_id=ANY(${selected.projects}::uuid[])
 AND (${selected.users}::text[] IS NULL OR c.commission_sales_user_id=ANY(${selected.users}::text[]))
 AND (${f.contract_status}='all' OR c.status=${f.contract_status})
 ), events AS(
 SELECT i.created_at AS occurred_at,i.created_by AS user_id,'—'::text AS currency,1::bigint AS calls,0::bigint AS followups,0::bigint AS done,0::bigint AS bookings,0::bigint AS sales,0::numeric AS value_minor,0::numeric AS calculated_minor,0::numeric AS earned_minor,0::numeric AS paid_minor,0::numeric AS recovered_minor
 FROM crm_interactions i WHERE i.company_id=${company} AND i.kind='call'
 AND (${selected.users}::text[] IS NULL OR i.created_by=ANY(${selected.users}::text[]))
 AND ((i.lead_id IS NOT NULL AND i.lead_id IN(SELECT id FROM visible_leads)) OR (i.lead_id IS NULL AND NOT ${!!f.project}))
 UNION ALL
 SELECT f.due_at,f.assigned_to,'—',0,1,CASE WHEN f.status='done' THEN 1 ELSE 0 END,0,0,0,0,0,0,0 FROM crm_follow_ups f
 WHERE f.company_id=${company} AND (${selected.users}::text[] IS NULL OR f.assigned_to=ANY(${selected.users}::text[]))
 AND ((f.lead_id IS NOT NULL AND f.lead_id IN(SELECT id FROM visible_leads)) OR (f.lead_id IS NULL AND NOT ${!!f.project}))
 UNION ALL
 SELECT b.created_at,b.sales_user_id,'—',0,0,0,1,0,0,0,0,0,0 FROM bookings b WHERE b.company_id=${company}
 AND b.project_id=ANY(${selected.projects}::uuid[]) AND (${selected.users}::text[] IS NULL OR b.sales_user_id=ANY(${selected.users}::text[]))
 AND (${f.booking_status}='all' OR b.status=${f.booking_status})
 UNION ALL
 SELECT c.signed_at,c.commission_sales_user_id,c.commission_currency,0,0,0,0,CASE WHEN c.status<>'cancelled' THEN 1 ELSE 0 END,
 CASE WHEN c.status<>'cancelled' THEN c.value_final_minor ELSE 0 END,
 CASE WHEN c.project_id=ANY(${commissionProjects}::uuid[]) THEN c.commission_total_minor ELSE 0 END,
 CASE WHEN c.project_id=ANY(${commissionProjects}::uuid[]) THEN c.earned_minor ELSE 0 END,0,0 FROM visible_contracts c
 UNION ALL
 SELECT l.created_at,c.commission_sales_user_id,c.commission_currency,0,0,0,0,0,0,0,0,
 CASE WHEN l.kind='payment' THEN l.amount_minor ELSE 0 END,CASE WHEN l.kind='recovery' THEN l.amount_minor ELSE 0 END
 FROM commission_ledger l JOIN visible_contracts c ON c.company_id=l.company_id AND c.id=l.contract_id
 WHERE l.company_id=${company} AND c.project_id=ANY(${commissionProjects}::uuid[])
 ), grouped AS(
 SELECT date_trunc(${f.group}::text,occurred_at AT TIME ZONE ${zone})::date::text AS period,user_id,currency,
 sum(calls)::int AS calls,sum(followups)::int AS followups,sum(done)::int AS completed_followups,sum(bookings)::int AS bookings,sum(sales)::int AS sales,
 sum(value_minor)::text AS contract_value_minor,sum(calculated_minor)::text AS calculated_minor,sum(earned_minor)::text AS earned_minor,sum(paid_minor)::text AS paid_minor,sum(recovered_minor)::text AS recovered_minor
 FROM events WHERE occurred_at>=(${f.from}::date::timestamp AT TIME ZONE ${zone})
 AND occurred_at<((${f.to}::date+1)::timestamp AT TIME ZONE ${zone})
 GROUP BY period,user_id,currency)
 SELECT
 (SELECT COALESCE(json_agg(r),'[]'::json) FROM(SELECT g.*,COALESCE(m.email,g.user_id) AS salesperson FROM grouped g LEFT JOIN memberships m ON m.company_id=${company} AND m.user_id=g.user_id ORDER BY period DESC,salesperson,user_id,currency LIMIT 100 OFFSET ${f.page*100})r) AS rows,
 (SELECT json_build_object('calls',COALESCE(sum(calls),0)::int,'followups',COALESCE(sum(followups),0)::int,'completed_followups',COALESCE(sum(completed_followups),0)::int,'bookings',COALESCE(sum(bookings),0)::int,'sales',COALESCE(sum(sales),0)::int) FROM grouped) AS totals,
 (SELECT COALESCE(json_agg(m),'[]'::json) FROM(SELECT currency,sum(contract_value_minor::numeric)::text AS contract_value_minor,sum(calculated_minor::numeric)::text AS calculated_minor,sum(earned_minor::numeric)::text AS earned_minor,sum(paid_minor::numeric)::text AS paid_minor,sum(recovered_minor::numeric)::text AS recovered_minor FROM grouped WHERE currency<>'—' GROUP BY currency ORDER BY currency)m) AS money,
 (SELECT count(*)::int FROM grouped) AS total_rows,
 (SELECT COALESCE(json_agg(t ORDER BY t.period),'[]'::json) FROM (
   SELECT period,sum(calls)::int AS calls,sum(followups)::int AS followups,
     sum(completed_followups)::int AS completed_followups,sum(bookings)::int AS bookings,sum(sales)::int AS sales
   FROM grouped GROUP BY period
 ) t) AS trend,
 (SELECT COALESCE(json_agg(rep),'[]'::json) FROM (
   SELECT g.user_id,COALESCE(m.email,g.user_id) AS salesperson,
     sum(g.calls)::int AS calls,sum(g.followups)::int AS followups,
     sum(g.completed_followups)::int AS completed_followups,
     sum(g.bookings)::int AS bookings,sum(g.sales)::int AS sales
   FROM grouped g LEFT JOIN memberships m ON m.company_id=${company} AND m.user_id=g.user_id
   GROUP BY g.user_id,m.email
   ORDER BY sales DESC,bookings DESC,calls DESC,salesperson ASC LIMIT 100
 ) rep) AS representatives,
 (SELECT count(DISTINCT user_id)::int FROM grouped) AS representatives_total`;
 return {...result[0],projects:scope.projects,members:scope.members,time_zone:zone,can_read_commissions:commissionProjects.length>0,generated_at:new Date().toISOString(),filters:f,page:f.page};
}