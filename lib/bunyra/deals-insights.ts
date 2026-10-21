import {z} from 'zod';
import {access,ServiceError,type Actor,type Sql,uuid} from './service';
import {reportScope,scopeFilters,dateValue} from './report-scope';
import {projectAllowed} from './record-scope';
import {requireEntitlement} from './subscriptions';

/** Financial insights are snapshots for contracts SIGNED in the chosen period.
 * Collections are cumulative confirmed net receipts against those contracts,
 * NOT collections received during the period. Never add different currencies. */
const filters=z.object({
 project:uuid.optional(),
 user:z.string().min(1).max(200).optional(),
 from:z.string().refine(dateValue),
 to:z.string().refine(dateValue),
 group:z.enum(['day','week','month']).default('month'),
 page:z.coerce.number().int().min(0).max(10000).default(0)
}).strict();

export async function dealsInsights(sql:Sql,actor:Actor,company:string,input:unknown,platform=false){
 const f=filters.parse(input);
 await requireEntitlement(sql,actor,company,'deals_insights',platform);
 if(f.from>f.to||(Date.parse(f.to)-Date.parse(f.from))/86400000>366)throw new ServiceError('INVALID_DATE_RANGE',400);
 // Demand BOTH report and finance permissions. Filter projects by effective
 // project-level permission on each action before querying the secure view.
 const finance=await reportScope(sql,actor,company,'finance.read',platform);
 const report=await access(sql,actor,company,'reports.read',platform);
 const projects=finance.projects.filter(p=>projectAllowed(report,'reports.read',p.id) && projectAllowed(finance.ctx,'finance.read',p.id));
 const selected=scopeFilters({...finance,projects},f.project,f.user);
 const zone=(await sql`SELECT time_zone FROM company_settings WHERE company_id=${company}`)[0]?.time_zone||'Africa/Cairo';
 const values=await sql`
 WITH eligible AS MATERIALIZED(
  SELECT c.id,c.project_id,c.commission_sales_user_id AS seller,c.commission_currency AS currency,
         c.signed_at,c.status,c.value_final_minor::numeric AS signed_minor,
         c.net_collected_minor::numeric AS net_minor
  FROM commission_balances c
  WHERE c.company_id=${company}
    AND c.project_id=ANY(${selected.projects}::uuid[])
    AND (${selected.users}::text[] IS NULL OR c.commission_sales_user_id=ANY(${selected.users}::text[]))
    AND c.status IN ('active','completed')
    AND c.signed_at >= (${f.from}::date::timestamp AT TIME ZONE ${zone})
    AND c.signed_at < ((${f.to}::date + 1)::timestamp AT TIME ZONE ${zone})
 ), ranked AS(
  SELECT *,GREATEST(0,signed_minor-net_minor) AS outstanding_minor,
           GREATEST(0,net_minor-signed_minor) AS excess_minor,
           date_trunc(${f.group}::text,signed_at AT TIME ZONE ${zone})::date::text AS period
  FROM eligible
 ), money AS(
  SELECT currency,count(*)::int AS contracts,
     sum(signed_minor)::text AS contract_value_minor,
     sum(net_minor)::text AS collected_minor,
     sum(outstanding_minor)::text AS outstanding_minor,
     sum(excess_minor)::text AS excess_minor
  FROM ranked GROUP BY currency
 ), timeline AS(
  SELECT period,currency,count(*)::int AS contracts,
    sum(signed_minor)::text AS contract_value_minor,
    sum(net_minor)::text AS collected_minor,
    sum(outstanding_minor)::text AS outstanding_minor
  FROM ranked GROUP BY period,currency
 ), by_project AS(
  SELECT r.project_id,p.name AS project_name,r.currency,count(*)::int AS contracts,
    sum(r.signed_minor)::text AS contract_value_minor,
    sum(r.net_minor)::text AS collected_minor,
    sum(r.outstanding_minor)::text AS outstanding_minor
  FROM ranked r JOIN projects p ON p.company_id=${company} AND p.id=r.project_id
  GROUP BY r.project_id,p.name,r.currency
 )
 SELECT
  (SELECT COALESCE(json_agg(m ORDER BY m.currency),'[]'::json) FROM money m) AS money,
  (SELECT COALESCE(json_agg(t ORDER BY t.period,t.currency),'[]'::json) FROM timeline t) AS trend,
  (SELECT COALESCE(json_agg(p ORDER BY p.project_name,p.currency),'[]'::json) FROM by_project p) AS projects,
  (SELECT count(*)::int FROM eligible) AS total_contracts
 `;
 return {...values[0],available_projects:projects,members:finance.members,
  time_zone:zone,as_of:new Date().toISOString(),page:f.page,filters:f,
  interpretation:'signed_contract_cohort_current_net_collections'};
}
