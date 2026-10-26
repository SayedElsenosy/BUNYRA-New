import {access,ServiceError,type Sql,type Actor} from './service';
import {projectAllowed} from './record-scope';

export async function overdueInstallments(sql:Sql,actor:Actor,company:string,page=1,platform=false){
 const ctx=await access(sql,actor,company,'finance.read',platform);
 if(!ctx.owner&&!['company_admin','finance_manager','accountant'].includes(ctx.role))
  throw new ServiceError('FORBIDDEN',403);
 const projects=await sql`SELECT id FROM projects WHERE company_id=${company}::uuid`;
 const ids=projects.filter(p=>projectAllowed(ctx,'finance.read',p.id)).map(p=>p.id as string);
 if(!ids.length)return {rows:[],total:0};
 const offset=(page-1)*50;
 const rows=await sql`SELECT c.customer_id,MAX(b.customer_name) AS customer_name,
 COALESCE(c.payment_plan_snapshot->'book'->>'currency','EGP') AS currency_code,
 COALESCE(sum(i.amount_minor-i.paid_minor),0)::text AS total_minor,
 COALESCE(sum(i.amount_minor-i.paid_minor) FILTER(WHERE ((now() AT TIME ZONE 'Africa/Cairo')::date-i.due_date) BETWEEN 1 AND 30),0)::text AS days_1_30_minor,
 COALESCE(sum(i.amount_minor-i.paid_minor) FILTER(WHERE ((now() AT TIME ZONE 'Africa/Cairo')::date-i.due_date) BETWEEN 31 AND 60),0)::text AS days_31_60_minor,
 COALESCE(sum(i.amount_minor-i.paid_minor) FILTER(WHERE ((now() AT TIME ZONE 'Africa/Cairo')::date-i.due_date)>60),0)::text AS over_60_minor,
 COUNT(*)::int AS installment_count
 FROM contract_installments i
 JOIN contracts c ON c.company_id=i.company_id AND c.id=i.contract_id
 JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
 WHERE i.company_id=${company}::uuid AND c.project_id=ANY(${ids}::uuid[])
 AND c.status='active' AND i.status NOT IN('paid','waived')
 AND i.paid_minor<i.amount_minor AND i.due_date<(now() AT TIME ZONE 'Africa/Cairo')::date
 GROUP BY c.customer_id,COALESCE(c.payment_plan_snapshot->'book'->>'currency','EGP')
 ORDER BY sum(i.amount_minor-i.paid_minor) DESC LIMIT 50 OFFSET ${offset}`;
 const total=(await sql`SELECT count(*)::int AS n FROM (
 SELECT c.customer_id,COALESCE(c.payment_plan_snapshot->'book'->>'currency','EGP')
 FROM contract_installments i JOIN contracts c ON c.company_id=i.company_id AND c.id=i.contract_id
 WHERE i.company_id=${company}::uuid AND c.project_id=ANY(${ids}::uuid[])
 AND c.status='active' AND i.status NOT IN('paid','waived')
 AND i.paid_minor<i.amount_minor AND i.due_date<(now() AT TIME ZONE 'Africa/Cairo')::date
 GROUP BY c.customer_id,COALESCE(c.payment_plan_snapshot->'book'->>'currency','EGP')
 ) groups`)[0]?.n??0;
 return {rows,total};
}
