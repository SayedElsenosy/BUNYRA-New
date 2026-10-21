import {z} from 'zod';
import {workspaceTaskContext,workspaceTaskSql} from './workspace-hub';
import {allowedCompanyViews} from './workspace-navigation';
import {hasPermission,type Action} from './permissions';
import {type Actor,type Sql,uuid} from './service';

export const dashboardQuery=z.object({company:uuid}).strict();

export async function roleDashboard(sql:Sql,actor:Actor,input:unknown,platform=false){
 const {company}=dashboardQuery.parse(input);
 // Central Workspace CTE remains the authority for task/lead/booking visibility.
 const scope=await workspaceTaskContext(sql,actor,company,platform);
 const ctx=scope.ctx;
 const projects=await sql`SELECT id FROM projects WHERE company_id=${company}`;
 const permitted=(action:Action)=>projects.filter(p=>ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,action,p.id)).map(p=>p.id as string);
 const intersection=(first:string[],second:string[])=>first.filter(p=>second.includes(p));
 const bookings=intersection(permitted('projects.read'),permitted('bookings.read'));
 const commission=intersection(bookings,permitted('commissions.read'));
 const finance=intersection(bookings,permitted('finance.read'));
 const financial=scope.can('finance.read')&&finance.length>0;
 const commissions=scope.can('commissions.read')&&commission.length>0;
 // Finance gets only finance-authorized contracts, sales gets only booking-authorized
 // contract values. This prevents mixing a broadly visible value denominator with
 // a partially restricted collection numerator.
 const contractProjects=financial?finance:bookings;
 const query=workspaceTaskSql+`, authorized_signed AS(
  SELECT c.id,c.project_id,c.commission_sales_user_id,c.commission_currency AS currency,
   c.signed_at,c.value_final_minor::numeric AS signed_minor,c.net_collected_minor::numeric AS net_minor,
   c.commission_total_minor::numeric AS commission_minor,c.earned_minor::numeric AS earned_minor
  FROM commission_balances c
  WHERE c.company_id=$1::uuid AND c.project_id=ANY($16::uuid[])
    AND c.status IN('active','completed')
    AND ($2::text[] IS NULL OR c.commission_sales_user_id=ANY($2::text[]))
 ), money AS(
  SELECT currency,count(*)::int AS contracts,
   sum(signed_minor)::text AS contract_value_minor,
   CASE WHEN $19::boolean THEN sum(net_minor)::text ELSE NULL::text END AS net_collected_minor,
   CASE WHEN $19::boolean THEN sum(GREATEST(0,signed_minor-net_minor))::text ELSE NULL::text END AS outstanding_minor,
   CASE WHEN $20::boolean THEN sum(CASE WHEN project_id=ANY($17::uuid[]) THEN commission_minor ELSE 0 END)::text ELSE NULL::text END AS commissions_minor,
   CASE WHEN $20::boolean THEN sum(CASE WHEN project_id=ANY($17::uuid[]) THEN earned_minor ELSE 0 END)::text ELSE NULL::text END AS earned_minor
  FROM authorized_signed GROUP BY currency
 ), pipeline AS(
  SELECT status,count(*)::int AS total FROM visible_leads GROUP BY status
 ), team AS(
  SELECT l.owner_user_id AS user_id,COALESCE(m.email,l.owner_user_id) AS label,
   count(*) FILTER(WHERE l.status NOT IN('won','lost'))::int AS open,
   count(*) FILTER(WHERE l.status='won')::int AS won,
   count(*)::int AS total
  FROM visible_leads l
  LEFT JOIN memberships m ON m.company_id=$1::uuid AND m.user_id=l.owner_user_id
  GROUP BY l.owner_user_id,m.email
  ORDER BY open DESC,won DESC,label ASC LIMIT 8
 ), urgent AS(
  SELECT id,kind,title,context,due_at,record_id,view,bucket,version,
   CASE bucket WHEN 'overdue' THEN 0 WHEN 'today' THEN 1 WHEN 'waiting' THEN 2 WHEN 'tomorrow' THEN 3 ELSE 4 END AS priority
  FROM tasks
  ORDER BY priority,due_at NULLS LAST,created_at,id,kind LIMIT 6
 ), days AS(
  SELECT generate_series(
   (($14::timestamptz AT TIME ZONE $13::text)::date-6)::timestamp,
   ($14::timestamptz AT TIME ZONE $13::text)::date::timestamp,
   interval '1 day')::date AS day
 ), activity AS(
  SELECT (i.created_at AT TIME ZONE $13::text)::date AS day,1 AS calls,0 AS bookings,0 AS contracts
  FROM crm_interactions i
  WHERE i.company_id=$1::uuid AND i.kind='call' AND $9::boolean
    AND ($2::text[] IS NULL OR i.created_by=ANY($2::text[]))
    AND (i.lead_id IN(SELECT id FROM visible_leads)
      OR (i.lead_id IS NULL AND EXISTS(SELECT 1 FROM visible_customers c WHERE c.id=i.customer_id)))
    AND i.created_at>=($14::timestamptz-interval '8 days')
  UNION ALL
  SELECT (b.created_at AT TIME ZONE $13::text)::date,0,1,0
  FROM visible_bookings b WHERE b.created_at>=($14::timestamptz-interval '8 days')
  UNION ALL
  SELECT (c.signed_at AT TIME ZONE $13::text)::date,0,0,1
  FROM authorized_signed c WHERE c.signed_at>=($14::timestamptz-interval '8 days')
 ), trend AS(
  SELECT d.day::text AS day,COALESCE(sum(a.calls),0)::int AS calls,
  COALESCE(sum(a.bookings),0)::int AS bookings,
  COALESCE(sum(a.contracts),0)::int AS contracts
  FROM days d LEFT JOIN activity a ON a.day=d.day GROUP BY d.day ORDER BY d.day
 )
 SELECT
 (SELECT jsonb_build_object(
    'customers',(SELECT count(*)::int FROM visible_customers),
    'open_leads',(SELECT count(*)::int FROM visible_leads WHERE status NOT IN('won','lost')),
    'available_units',(SELECT count(*)::int FROM visible_units WHERE status='available'),
    'bookings_pending',(SELECT count(*)::int FROM visible_bookings WHERE status='submitted'),
    'receipts_pending',(SELECT count(*)::int FROM visible_bookings WHERE status IN('approved','accounts_pending') AND project_id=ANY($8::uuid[])),
    'active_contracts',(SELECT count(*)::int FROM authorized_signed),
    'tasks',(SELECT count(*)::int FROM tasks),
    'overdue',(SELECT count(*)::int FROM tasks WHERE bucket='overdue'),
    'today',(SELECT count(*)::int FROM tasks WHERE bucket='today'),
    'waiting',(SELECT count(*)::int FROM tasks WHERE bucket='waiting')
  )) AS metrics,
 (SELECT COALESCE(jsonb_agg(m ORDER BY m.currency),'[]'::jsonb) FROM money m) AS money,
 (SELECT COALESCE(jsonb_agg(p ORDER BY p.status),'[]'::jsonb) FROM pipeline p) AS pipeline,
 (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM team t) AS team,
 (SELECT COALESCE(jsonb_agg(u ORDER BY u.priority,u.due_at NULLS LAST),'[]'::jsonb) FROM urgent u) AS urgent,
 (SELECT COALESCE(jsonb_agg(t ORDER BY t.day),'[]'::jsonb) FROM trend t) AS trend`;
 const rows=await sql.query(query,[...scope.params,contractProjects,commission,finance,financial,commissions]);
 const m=rows[0];
 return {
  role:ctx.role,owner:ctx.owner,time_zone:scope.timeZone,as_of:scope.now,
  capabilities:{
   crm:scope.can('leads.read'),write_crm:scope.can('leads.write')&&scope.can('leads.read'),
   inventory:scope.inventoryVisible,bookings:scope.can('bookings.read'),
   finance:financial,commissions,team:ctx.owner||['company_admin','sales_manager','sales_admin'].includes(ctx.role)
  },
  allowed_views:allowedCompanyViews(ctx,projects.map(p=>p.id as string)),
  metrics:m.metrics,money:m.money,pipeline:m.pipeline,team:m.team,urgent:m.urgent,trend:m.trend,
  interpretation:'active_contracts_and_confirmed_net_collection_by_currency',
 };
}
