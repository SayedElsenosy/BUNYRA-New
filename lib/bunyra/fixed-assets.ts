import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
const manage=async(sql:Sql,actor:Actor,company:string,action:'finance.read'|'finance.write'|'finance.approve',platform:boolean)=>{
 const ctx=await access(sql,actor,company,action,platform);
 if(!ctx.owner&&!['company_admin','finance_manager'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
};
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const registry=z.object({
 company_id:uuid,entity_id:uuid,project_id:uuid.nullable().default(null),
 code:z.string().trim().min(2).max(40),name:z.string().trim().min(2).max(200),
 acquisition_date:date,service_date:date,
 cost_minor:z.string().regex(/^\d{1,18}$/),residual_minor:z.string().regex(/^\d{1,18}$/),
 useful_life_months:z.number().int().min(1).max(600),
 asset_account_id:uuid,accumulated_account_id:uuid,expense_account_id:uuid,journal_id:uuid
}).strict();
const posting=z.object({company_id:uuid,asset_id:uuid,period_month:date}).strict();
export async function fixedAssetsOverview(sql:Sql,actor:Actor,company:string,platform=false){
 await manage(sql,actor,company,'finance.read',platform);
 const assets=await sql`SELECT a.id,a.entity_id,a.project_id,a.code,a.name,a.acquisition_date,
  a.service_date,a.cost_minor::text AS cost_minor,a.residual_minor::text AS residual_minor,
  a.useful_life_months,a.asset_account_id,a.accumulated_account_id,a.expense_account_id,
  a.journal_id,COALESCE(d.amount_minor,0)::text AS accumulated_depreciation_minor,
  COALESCE(d.months,0)::int AS posted_months,d.last_period
 FROM finance_fixed_assets a
 LEFT JOIN LATERAL (
  SELECT sum(x.amount_minor::numeric) AS amount_minor,count(*) AS months,max(x.period_month) AS last_period
  FROM finance_asset_depreciations x WHERE x.company_id=a.company_id AND x.entity_id=a.entity_id AND x.asset_id=a.id
 ) d ON TRUE WHERE a.company_id=${company} ORDER BY a.code LIMIT 1000`;
 return {assets,implemented_scope:'asset_register_and_monthly_depreciation'};
}
export async function createFixedAsset(sql:Sql,actor:Actor,input:unknown,platform=false){
 const a=registry.parse(input);await manage(sql,actor,a.company_id,'finance.write',platform);
 const cost=BigInt(a.cost_minor),residual=BigInt(a.residual_minor);
 if(cost<=0n||cost-residual<BigInt(a.useful_life_months)||a.acquisition_date>a.service_date)
  throw new ServiceError('ASSET_INVALID_COST_OR_DATES',422);
 const valid=(await sql`SELECT
  EXISTS(SELECT 1 FROM ledger_accounts WHERE company_id=${a.company_id} AND entity_id=${a.entity_id} AND id=${a.asset_account_id} AND kind='asset' AND active AND allow_posting) AS asset_ok,
  EXISTS(SELECT 1 FROM ledger_accounts WHERE company_id=${a.company_id} AND entity_id=${a.entity_id} AND id=${a.accumulated_account_id} AND kind='asset' AND active AND allow_posting) AS accumulated_ok,
  EXISTS(SELECT 1 FROM ledger_accounts WHERE company_id=${a.company_id} AND entity_id=${a.entity_id} AND id=${a.expense_account_id} AND kind='expense' AND active AND allow_posting) AS expense_ok,
  EXISTS(SELECT 1 FROM ledger_journals WHERE company_id=${a.company_id} AND entity_id=${a.entity_id} AND id=${a.journal_id} AND active) AS journal_ok`)[0];
 if(!valid?.asset_ok||!valid?.accumulated_ok||!valid?.expense_ok||!valid?.journal_ok
 ||new Set([a.asset_account_id,a.accumulated_account_id,a.expense_account_id]).size!==3)
  throw new ServiceError('ASSET_ACCOUNT_MAPPING_INVALID',422);
 const id=crypto.randomUUID();
 const result=await sql.transaction([
  sql`INSERT INTO finance_fixed_assets(id,company_id,entity_id,project_id,code,name,
   acquisition_date,service_date,cost_minor,residual_minor,useful_life_months,
   asset_account_id,accumulated_account_id,expense_account_id,journal_id,created_by)
  VALUES(${id},${a.company_id},${a.entity_id},${a.project_id},${a.code},${a.name},
   ${a.acquisition_date}::date,${a.service_date}::date,${a.cost_minor}::bigint,
   ${a.residual_minor}::bigint,${a.useful_life_months},
   ${a.asset_account_id},${a.accumulated_account_id},${a.expense_account_id},
   ${a.journal_id},${actor.userId}) RETURNING id,code,name`,
  sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
   VALUES(${a.company_id},${actor.userId},${actor.email},'finance.fixed_asset_created',
    jsonb_build_object('asset_id',${id}::uuid,'cost_minor',${a.cost_minor}::bigint))
   RETURNING id`
 ]);
 return {asset:result[0][0]};
}
export async function postAssetDepreciation(sql:Sql,actor:Actor,input:unknown,platform=false){
 const p=posting.parse(input);await manage(sql,actor,p.company_id,'finance.approve',platform);
 if(p.period_month.slice(8)!=='01')throw new ServiceError('ASSET_INVALID_PERIOD',400);
 const row=(await sql`SELECT bunyra_post_asset_depreciation(${p.company_id}::uuid,
  ${p.asset_id}::uuid,${p.period_month}::date) AS entry_id`)[0];
 return {entry_id:row.entry_id,status:'posted'};
}
