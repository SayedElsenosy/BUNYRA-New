import {z} from 'zod';
import {access,ServiceError,uuid,type Actor,type Sql} from './service';
import {hasPermission} from './permissions';
import {salesScope,projectAllowed} from './record-scope';
import {requireFeature} from './subscriptions';
import {bindTenant} from './tenant';

const quarter=z.string().regex(/^20[0-9]{2}-(01|04|07|10)-01$/);
export const targetSchema=z.object({company_id:uuid,user_id:z.string().min(1).max(200),quarter_start:quarter,currency:z.string().regex(/^[A-Z]{3}$/),target_minor:z.string().regex(/^[1-9][0-9]{0,15}$/),version:z.number().int().min(0)}).strict();
export async function salesTargets(sql:Sql,actor:Actor,company:string,start?:string,platform=false){
 const ctx=await access(sql,actor,company,'company.read',platform);
 await requireFeature(sql,company,'crm',platform);
 const settings=(await sql`SELECT time_zone,currency FROM company_settings WHERE company_id=${company}`)[0];
 const zone=settings?.time_zone||'Africa/Cairo';
 const current=(await sql`SELECT date_trunc('quarter',now() AT TIME ZONE ${zone})::date::text AS day`)[0].day as string;
 const selected=quarter.parse(start||current);
 const manage=ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'accounts.manage');
 if(!manage&&!hasPermission(ctx.role,ctx.custom,ctx.overrides,'leads.read'))throw new ServiceError('FORBIDDEN',403);
 const users=manage?null:ctx.role==='sales_admin'?[actor.userId]:await salesScope(sql,actor,company,ctx);
 const projects=(await sql`SELECT id FROM projects WHERE company_id=${company}`).filter(p=>projectAllowed(ctx,'projects.read',p.id)&&projectAllowed(ctx,'bookings.read',p.id)).map(p=>p.id as string);
 // Currency and signed date come from the immutable sale attribution snapshot.
 // Current cancelled contracts disappear automatically; offers/lead stages never count.
 const rows=await sql`SELECT m.user_id,m.email AS label,m.active,t.currency,t.target_minor::text,t.version,
 COALESCE((SELECT sum(c.value_final_minor)::text FROM contracts c WHERE c.company_id=m.company_id
 AND c.commission_sales_user_id=m.user_id AND c.status IN('active','completed') AND c.commission_currency=t.currency
 AND c.project_id=ANY(${projects}::uuid[]) AND c.signed_at>=(${selected}::date::timestamp AT TIME ZONE ${zone})
 AND c.signed_at< ((${selected}::date+interval '3 months') AT TIME ZONE ${zone})),'0') AS achieved_minor
 FROM memberships m LEFT JOIN quarterly_sales_targets t ON t.company_id=m.company_id AND t.user_id=m.user_id AND t.quarter_start=${selected}::date
 WHERE m.company_id=${company} AND (m.role IN('sales','sales_manager','sales_admin') OR t.user_id IS NOT NULL)
 AND (${users}::text[] IS NULL OR m.user_id=ANY(${users}::text[])) ORDER BY m.email`;
 // Account metadata is outside tenant SQL; select names only for already scoped rows.
 bindTenant(sql,null);let names;
 try{names=await sql`SELECT user_id,display_name FROM app_accounts WHERE company_id=${company} AND user_id=ANY(${rows.map(r=>r.user_id)}::text[])`;}finally{bindTenant(sql,company,actor.userId);}
 return {quarter_start:selected,current_quarter:current,time_zone:zone,currency:settings?.currency||'EGP',can_manage:manage,rows:rows.map(r=>({...r,label:names.find(n=>n.user_id===r.user_id)?.display_name||r.label})),scope:'permitted_projects'};
}
export async function saveSalesTarget(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=targetSchema.parse(input);
 await access(sql,actor,c.company_id,'accounts.manage',platform);
 await requireFeature(sql,c.company_id,'crm',platform);
 const results=await sql.transaction([
 sql`SELECT user_id FROM memberships WHERE company_id=${c.company_id} AND user_id=${c.user_id} FOR UPDATE`,
 sql`WITH eligible AS(SELECT user_id FROM memberships WHERE company_id=${c.company_id} AND user_id=${c.user_id} AND active AND role IN('sales','sales_manager','sales_admin')),
 previous AS(SELECT * FROM quarterly_sales_targets WHERE company_id=${c.company_id} AND user_id=${c.user_id} AND quarter_start=${c.quarter_start}::date FOR UPDATE),
 changed AS(INSERT INTO quarterly_sales_targets(company_id,user_id,quarter_start,currency,target_minor)
 SELECT ${c.company_id},user_id,${c.quarter_start}::date,${c.currency},${c.target_minor}::bigint FROM eligible
 WHERE ${c.version}=0 AND NOT EXISTS(SELECT 1 FROM previous)
 ON CONFLICT DO NOTHING RETURNING *),
 updated AS(UPDATE quarterly_sales_targets SET currency=${c.currency},target_minor=${c.target_minor}::bigint,version=version+1,updated_at=now()
 WHERE company_id=${c.company_id} AND user_id IN(SELECT user_id FROM eligible) AND quarter_start=${c.quarter_start}::date AND version=${c.version} AND ${c.version}>0 RETURNING *),
 saved AS(SELECT * FROM changed UNION ALL SELECT * FROM updated),
 logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data)
 SELECT ${c.company_id},${actor.userId},${actor.email},'sales_target.saved',(SELECT to_jsonb(previous) FROM previous),to_jsonb(saved) FROM saved)
 SELECT version FROM saved`]);
 if(!results[1].length)throw new ServiceError('TARGET_CONFLICT_OR_INACTIVE_MEMBER',409);
 return {ok:true,version:results[1][0].version};
}
