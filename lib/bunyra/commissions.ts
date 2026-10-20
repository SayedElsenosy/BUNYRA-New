import {z} from 'zod';
import {access,uuid,ServiceError,type Sql,type Actor} from './service';
import {projectAllowed} from './record-scope';
import {reportScope,scopeFilters,dateValue} from './report-scope';
import {minorUnits} from './projects';
const filters=z.object({project:z.string().uuid().optional(),user:z.string().max(200).optional(),from:z.string().refine(dateValue).optional(),to:z.string().refine(dateValue).optional(),state:z.enum(['all','unconfigured','pending','eligible','paid','recovery','cancelled','no_commission']).default('all'),page:z.coerce.number().int().min(0).max(10000).default(0)}).strict();
export const commissionStateSql="CASE WHEN NOT c.commission_configured THEN 'unconfigured' WHEN c.recoverable_minor>0 THEN 'recovery' WHEN c.status='cancelled' THEN 'cancelled' WHEN c.earned_minor>0 AND c.net_paid_minor>=c.earned_minor THEN 'paid' WHEN c.payable_minor>0 THEN 'eligible' WHEN c.commission_total_minor=0 THEN 'no_commission' ELSE 'pending' END";
export async function commissionOverview(sql:Sql,actor:Actor,company:string,input:unknown={},platform=false){
 const f=filters.parse(input);if(f.from&&f.to&&f.from>f.to)throw new ServiceError('INVALID_DATE_RANGE');
 const scope=await reportScope(sql,actor,company,'commissions.read',platform),selection=scopeFilters(scope,f.project,f.user);
 const tz=(await sql`SELECT time_zone FROM company_settings WHERE company_id=${company}`)[0]?.time_zone||'Africa/Cairo';
 const args:unknown[]=[company,selection.projects,selection.users];
 let where="c.company_id=$1 AND c.project_id=ANY($2::uuid[]) AND ($3::text[] IS NULL OR c.commission_sales_user_id=ANY($3::text[]))";
 if(f.from){args.push(f.from,tz);where+=" AND c.signed_at>=($"+(args.length-1)+"::date::timestamp AT TIME ZONE $"+args.length+")";}
 if(f.to){args.push(f.to,tz);where+=" AND c.signed_at<(($"+(args.length-1)+"::date+1)::timestamp AT TIME ZONE $"+args.length+")";}
 if(f.state!=='all'){args.push(f.state);where+=" AND ("+commissionStateSql+")=$"+args.length;}
 const [rows,summary,history]=await Promise.all([
 sql.query("SELECT c.id,c.project_id,c.contract_number,c.status,c.commission_sales_user_id,c.commission_currency AS currency,c.commission_rate_bps,c.commission_threshold_bps,c.commission_configured,c.commission_version,c.commission_total_minor::text,c.value_final_minor::text,c.net_collected_minor::text,c.earned_minor::text,c.net_paid_minor::text,c.payable_minor::text,c.recoverable_minor::text,c.signed_at,p.name AS project_name,m.email AS salesperson,("+commissionStateSql+") AS commission_state FROM commission_balances c JOIN projects p ON p.company_id=c.company_id AND p.id=c.project_id LEFT JOIN memberships m ON m.company_id=c.company_id AND m.user_id=c.commission_sales_user_id WHERE "+where+" ORDER BY c.signed_at DESC,c.id LIMIT 50 OFFSET "+(f.page*50),args),
 sql.query("SELECT c.commission_currency AS currency,count(*)::int AS contracts,sum(c.commission_total_minor)::text AS calculated_minor,sum(c.earned_minor)::text AS earned_minor,sum(c.net_paid_minor)::text AS paid_minor,sum(c.payable_minor)::text AS payable_minor,sum(c.recoverable_minor)::text AS recoverable_minor FROM commission_balances c WHERE "+where+" GROUP BY c.commission_currency",args),
 sql.query("SELECT l.id,l.contract_id,l.kind,l.amount_minor::text,l.reason,l.reference,l.created_by,l.created_at,c.contract_number,c.commission_currency AS currency FROM commission_ledger l JOIN commission_balances c ON c.company_id=l.company_id AND c.id=l.contract_id WHERE "+where+" ORDER BY l.created_at DESC,l.id LIMIT 100",args)
 ]);
 return {rows:rows.map(r=>({...r,can_configure:(scope.ctx.owner||['company_admin','operations'].includes(scope.ctx.role))&&projectAllowed(scope.ctx,'commissions.write',r.project_id),can_pay:(scope.ctx.owner||['company_admin','finance_manager','accountant'].includes(scope.ctx.role))&&projectAllowed(scope.ctx,'commissions.pay',r.project_id)})),summary,history,projects:scope.projects,members:scope.members,time_zone:tz,page:f.page};
}
export async function configureCommission(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=z.object({company_id:uuid,contract_id:uuid,rate_bps:z.number().int().min(0).max(10000).optional(),threshold_bps:z.number().int().min(0).max(10000),version:z.number().int().positive(),reason:z.string().trim().min(3).max(1000)}).strict().parse(input);
 const ctx=await access(sql,actor,c.company_id,'commissions.write',platform);
 const row=(await sql`SELECT project_id,commission_configured,commission_rate_bps FROM contracts WHERE company_id=${c.company_id} AND id=${c.contract_id}`)[0];
 if(!ctx.owner&&!['company_admin','operations'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
 if(!row)throw new ServiceError('NOT_FOUND',404);
 if(!projectAllowed(ctx,'commissions.write',row.project_id))throw new ServiceError('FORBIDDEN',403);
 if(row.commission_configured&&c.rate_bps!==undefined&&c.rate_bps!==row.commission_rate_bps)throw new ServiceError('COMMISSION_TERMS_IMMUTABLE',409);
 if(!row.commission_configured&&c.rate_bps===undefined)throw new ServiceError('COMMISSION_RATE_REQUIRED');
 const r=await sql.transaction([
 sql`SELECT set_config('app.commission_terms','1',true)`,
 sql`WITH previous AS MATERIALIZED(SELECT * FROM contracts WHERE company_id=${c.company_id} AND id=${c.contract_id} AND commission_version=${c.version} AND status<>'cancelled' FOR UPDATE),
 changed AS(UPDATE contracts SET commission_rate_bps=COALESCE(${c.rate_bps??null}::int,commission_rate_bps),commission_threshold_bps=${c.threshold_bps},commission_configured=true,commission_version=commission_version+1 WHERE company_id=${c.company_id} AND id IN(SELECT id FROM previous) RETURNING *),
 logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'commission.terms_updated',jsonb_build_object('rate_bps',previous.commission_rate_bps,'threshold_bps',previous.commission_threshold_bps,'configured',previous.commission_configured),jsonb_build_object('contract_id',changed.id,'rate_bps',changed.commission_rate_bps,'threshold_bps',changed.commission_threshold_bps,'total_minor',changed.commission_total_minor::text,'reason',${c.reason}::text) FROM previous JOIN changed USING(id))
 SELECT id,commission_version FROM changed`
 ]);if(!r[1].length)throw new ServiceError('VERSION_CONFLICT',409);return r[1][0];
}
export async function postCommission(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=z.object({company_id:uuid,contract_id:uuid,kind:z.enum(['payment','recovery']),amount:z.string().regex(/^[0-9]{1,14}([.][0-9]{1,2})?$/),request_id:uuid,reason:z.string().trim().min(3).max(1000),reference:z.string().trim().max(120).default('')}).strict().parse(input);
 const ctx=await access(sql,actor,c.company_id,'commissions.pay',platform);
 if(!ctx.owner&&!['company_admin','finance_manager','accountant'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
 const row=(await sql`SELECT project_id FROM contracts WHERE company_id=${c.company_id} AND id=${c.contract_id}`)[0];if(!row)throw new ServiceError('NOT_FOUND',404);
 if(!projectAllowed(ctx,'commissions.pay',row.project_id))throw new ServiceError('FORBIDDEN',403);
 const amount=minorUnits(c.amount);if(amount<=BigInt(0))throw new ServiceError('INVALID_AMOUNT');
 return (await sql`SELECT bunyra_post_commission(${c.company_id}::uuid,${c.contract_id}::uuid,${c.kind}::text,${amount.toString()}::bigint,${c.request_id}::uuid,${c.reason}::text,${c.reference}::text,${actor.userId}::text,${actor.email}::text) AS entry`)[0].entry;
}
