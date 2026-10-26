import {access,ServiceError,type Actor,type Sql} from './service';
import {projectAllowed} from './record-scope';
import {listPaymentAccounts} from './payment-accounts';

async function scope(sql:Sql,actor:Actor,company:string,platform:boolean){
 const ctx=await access(sql,actor,company,'finance.read',platform);
 if(!ctx.owner&&!['company_admin','finance_manager','accountant'].includes(ctx.role))
  throw new ServiceError('FORBIDDEN',403);
 const projects=await sql`SELECT id FROM projects WHERE company_id=${company}::uuid`;
 const ids=projects.filter(p=>projectAllowed(ctx,'finance.read',p.id)).map(p=>p.id as string);
 return {ids,ctx};
}
export type ReceiptFilter={company:string;page:number;type:string;status:string;from:string|null;to:string|null};
export async function treasuryReceipts(sql:Sql,actor:Actor,filters:ReceiptFilter,platform=false){
 const {ids,ctx}=await scope(sql,actor,filters.company,platform);
 if(!ids.length)return {receipts:[],total:0,today:[],pending:0,bounced:0,accounts:[],canWrite:false};
 const company=filters.company,limit=20,offset=(filters.page-1)*limit;
 const dateStart=filters.from, dateEnd=filters.to;
 const receipts=await sql`SELECT r.id,r.contract_id,r.installment_id,r.amount_minor::text,
 r.reference_number,r.method,r.cheque_state,r.created_at::text,c.contract_number,
 c.project_id,b.customer_name,COALESCE(c.payment_plan_snapshot->'book'->>'currency','EGP') AS currency_code
 FROM receipt_status r JOIN contracts c ON c.company_id=r.company_id AND c.id=r.contract_id
 JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
 WHERE r.company_id=${company}::uuid AND c.project_id=ANY(${ids}::uuid[])
 AND (${filters.type}='ALL' OR r.method=${filters.type})
 AND (${filters.status}='ALL' OR r.cheque_state=${filters.status})
 AND (${dateStart}::date IS NULL OR (r.created_at AT TIME ZONE 'Africa/Cairo')::date>=${dateStart}::date)
 AND (${dateEnd}::date IS NULL OR (r.created_at AT TIME ZONE 'Africa/Cairo')::date<=${dateEnd}::date)
 ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit} OFFSET ${offset}`;
 const total=(await sql`SELECT count(*)::int AS n FROM receipt_status r
 JOIN contracts c ON c.company_id=r.company_id AND c.id=r.contract_id
 WHERE r.company_id=${company}::uuid AND c.project_id=ANY(${ids}::uuid[])
 AND (${filters.type}='ALL' OR r.method=${filters.type})
 AND (${filters.status}='ALL' OR r.cheque_state=${filters.status})
 AND (${dateStart}::date IS NULL OR (r.created_at AT TIME ZONE 'Africa/Cairo')::date>=${dateStart}::date)
 AND (${dateEnd}::date IS NULL OR (r.created_at AT TIME ZONE 'Africa/Cairo')::date<=${dateEnd}::date)`)[0]?.n??0;
const [counts,today,accounts]=await Promise.all([
  sql`SELECT count(*) FILTER(WHERE r.method='CHEQUE' AND r.cheque_state='PENDING')::int AS pending,
  count(*) FILTER(WHERE r.method='CHEQUE' AND r.cheque_state='BOUNCED')::int AS bounced
  FROM receipt_status r JOIN contracts c ON c.company_id=r.company_id AND c.id=r.contract_id
  WHERE r.company_id=${company}::uuid AND c.project_id=ANY(${ids}::uuid[])`,
  sql`SELECT COALESCE(c.payment_plan_snapshot->'book'->>'currency','EGP') AS currency_code,
  coalesce(sum(col.amount_minor),0)::text AS amount_minor
  FROM collections col JOIN contracts c ON c.company_id=col.company_id AND c.id=col.contract_id
  WHERE col.company_id=${company}::uuid AND c.project_id=ANY(${ids}::uuid[])
  AND col.status='confirmed'
  AND (col.received_at AT TIME ZONE 'Africa/Cairo')::date=(now() AT TIME ZONE 'Africa/Cairo')::date
  GROUP BY 1 ORDER BY 1`,
  listPaymentAccounts(sql,company)
 ]);
 return {receipts,total,today,pending:counts[0]?.pending??0,bounced:counts[0]?.bounced??0,
  accounts,canWrite:!platform&&['company_admin','finance_manager','accountant'].includes(ctx.role)};
}

