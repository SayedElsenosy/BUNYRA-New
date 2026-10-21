import {z} from 'zod';
import {type Sql,type Actor,ServiceError} from './service';
import {reportScope,scopeFilters,dateValue} from './report-scope';
import {projectAllowed} from './record-scope';
import {hasPermission} from './permissions';
import {requireFeature} from './subscriptions';
const query=z.object({from:z.string().refine(dateValue),to:z.string().refine(dateValue),project:z.string().uuid().optional(),user:z.string().max(200).optional()}).strict();
export async function crmInsights(sql:Sql,actor:Actor,company:string,input:unknown,platform=false){
 const f=query.parse(input);if(f.from>f.to||Date.parse(f.to)-Date.parse(f.from)>366*86400000)throw new ServiceError('INVALID_DATE_RANGE');
 const scope=await reportScope(sql,actor,company,'reports.read',platform),selected=scopeFilters(scope,f.project,f.user);
 await requireFeature(sql,company,'advanced_reports',platform);
 const canRead=scope.ctx.owner||hasPermission(scope.ctx.role,scope.ctx.custom,scope.ctx.overrides,'leads.read');
 if(canRead)await requireFeature(sql,company,'crm',platform);
 const projects=selected.projects.filter(p=>projectAllowed(scope.ctx,'leads.read',p));
 const saleProjects=projects.filter(p=>projectAllowed(scope.ctx,'bookings.read',p));
 const zone=(await sql`SELECT time_zone FROM company_settings WHERE company_id=${company}`)[0]?.time_zone||'Africa/Cairo';
 const result=await sql`WITH cohort AS(
 SELECT l.*,c.full_name FROM crm_leads l JOIN crm_customers c ON c.company_id=l.company_id AND c.id=l.customer_id
 WHERE l.company_id=${company} AND ${canRead} AND (l.project_id=ANY(${projects}::uuid[]) OR (l.project_id IS NULL AND ${!f.project}))
 AND (${selected.users}::text[] IS NULL OR l.owner_user_id=ANY(${selected.users}::text[]))
 AND l.created_at>=(${f.from}::date::timestamp AT TIME ZONE ${zone}) AND l.created_at<((${f.to}::date+1)::timestamp AT TIME ZONE ${zone})
 ), converted AS(
 SELECT l.id,min(c.signed_at) AS signed_at FROM cohort l JOIN bookings b ON b.company_id=l.company_id AND b.lead_id=l.id
 JOIN contracts c ON c.company_id=b.company_id AND c.booking_id=b.id AND c.status IN('active','completed')
 WHERE c.project_id=ANY(${saleProjects}::uuid[]) AND (${selected.users}::text[] IS NULL OR c.commission_sales_user_id=ANY(${selected.users}::text[]))
 AND c.signed_at>=l.created_at AND c.signed_at<((${f.to}::date+1)::timestamp AT TIME ZONE ${zone}) GROUP BY l.id
 ), stages AS(
 SELECT stage_code,count(*)::int AS total,round(avg(extract(epoch FROM (now()-stage_changed_at))/86400)::numeric,1)::text AS average_days,
 count(stage_changed_at)::int AS tracked FROM cohort GROUP BY stage_code
 ), sources AS(
 SELECT l.source,count(*)::int AS leads,count(v.id)::int AS converted FROM cohort l LEFT JOIN converted v ON v.id=l.id GROUP BY l.source
 ), months AS(
 SELECT to_char(l.created_at AT TIME ZONE ${zone},'YYYY-MM') AS month,count(*)::int AS leads,count(v.id)::int AS converted
 FROM cohort l LEFT JOIN converted v ON v.id=l.id GROUP BY month
 )
 SELECT (SELECT count(*)::int FROM cohort) AS leads,(SELECT count(*)::int FROM converted) AS converted,
 (SELECT COALESCE(jsonb_agg(s ORDER BY s.total DESC),'[]'::jsonb) FROM stages s) AS stages,
 (SELECT COALESCE(jsonb_agg(s ORDER BY s.leads DESC),'[]'::jsonb) FROM sources s) AS sources,
 (SELECT COALESCE(jsonb_agg(m ORDER BY m.month),'[]'::jsonb) FROM months m) AS months,
 (SELECT jsonb_build_object('average',round(avg(extract(epoch FROM(v.signed_at-l.created_at))/86400)::numeric,1),'fastest',round(min(extract(epoch FROM(v.signed_at-l.created_at))/86400)::numeric,1),'slowest',round(max(extract(epoch FROM(v.signed_at-l.created_at))/86400)::numeric,1)) FROM converted v JOIN cohort l ON l.id=v.id) AS velocity,
 (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM(SELECT id,customer_id,full_name,source,stage_code,created_at FROM cohort ORDER BY created_at DESC LIMIT 5)x) AS recent`;
 const insight=result[0] as {
  leads:number;converted:number;
  stages:{stage_code:string;total:number;average_days:string|null;tracked:number}[];
  sources:{source:string;leads:number;converted:number}[];
  months:{month:string;leads:number;converted:number}[];
  velocity:{average:number|null;fastest:number|null;slowest:number|null};
  recent:{id:string;customer_id:string;full_name:string;source:string;stage_code:string}[];
 };
 return {...insight,can_read_crm:canRead,time_zone:zone,from:f.from,to:f.to};
}
