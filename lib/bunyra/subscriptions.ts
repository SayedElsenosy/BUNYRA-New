import {z} from 'zod';
import {ServiceError,access,owner,type Sql,type Actor,uuid} from './service';
import {bindTenant} from './tenant';
import {hasPermission} from './permissions';

export const featureNames=['crm','inventory','floorplans','buyer_matching','advanced_reports','commissions','finance_erp','whatsapp'] as const;
export type Feature=typeof featureNames[number];
const features=z.record(z.enum(featureNames),z.boolean()).default({});
const price=z.number().int().min(0).max(9007199254740991).nullable().default(null);
const planSchema=z.object({
 code:z.string().regex(/^[a-z][a-z0-9_-]{2,39}$/),
 name_ar:z.string().trim().min(2).max(120),name_en:z.string().trim().min(2).max(120),
 billing_period:z.enum(['month','year']),currency:z.string().regex(/^[A-Z]{3}$/),
 price_minor:price,included_seats:z.number().int().min(1).max(10000),
 included_projects:z.number().int().min(1).max(10000),
 features,active:z.boolean().default(true)
}).strict();
const updatePlan=planSchema.extend({id:uuid,version:z.number().int().positive()});
const assign=z.object({
 company_id:uuid,plan_id:uuid,
 seat_limit:z.number().int().min(1).max(10000),
 project_limit:z.number().int().min(1).max(10000),
 agreed_price_minor:price,
 status:z.enum(['trial','active','grace','suspended']).default('active'),
 starts_at:z.string().datetime(),ends_at:z.string().datetime().nullable().default(null),
 version:z.number().int().min(0)
}).strict();

async function requireOwner(sql:Sql,actor:Actor){
 bindTenant(sql,null);
 if(!await owner(sql,actor))throw new ServiceError('FORBIDDEN',403);
}
export async function planCatalog(sql:Sql,actor:Actor){
 await requireOwner(sql,actor);
 const [plans,subscriptions,companies]=await Promise.all([
  sql`SELECT * FROM subscription_plans ORDER BY code`,
  sql`SELECT s.*,p.code AS plan_code,c.name AS company_name,
  (SELECT count(*)::int FROM memberships m WHERE m.company_id=s.company_id AND m.active) AS used_seats,
  (SELECT count(*)::int FROM projects j WHERE j.company_id=s.company_id) AS used_projects
  FROM company_subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
  JOIN companies c ON c.id=s.company_id ORDER BY c.name`,
  sql`SELECT id,name,account_limit,version,
   (SELECT count(*)::int FROM memberships m WHERE m.company_id=c.id AND m.active) AS used_seats,
   (SELECT count(*)::int FROM projects j WHERE j.company_id=c.id) AS used_projects
   FROM companies c WHERE c.status<>'deleted' ORDER BY name`
 ]);
 return {plans,subscriptions,companies};
}
export async function savePlan(sql:Sql,actor:Actor,input:unknown){
 await requireOwner(sql,actor);
 const candidate=(input as Record<string,unknown>)?.id;
 const c=candidate?updatePlan.parse(input):planSchema.parse(input);
 const version=candidate?updatePlan.parse(input).version:0;
 const json=JSON.stringify(c.features);
 if('id' in c){
  const rows=await sql`WITH previous AS(
   SELECT * FROM subscription_plans WHERE id=${c.id} AND version=${version} FOR UPDATE
  ),changed AS(
   UPDATE subscription_plans SET name_ar=${c.name_ar},name_en=${c.name_en},billing_period=${c.billing_period},
   currency=${c.currency},price_minor=${c.price_minor},included_seats=${c.included_seats},included_projects=${c.included_projects},
   features=${json}::jsonb,active=${c.active},version=version+1,updated_at=now()
   WHERE id IN(SELECT id FROM previous) AND code=${c.code} RETURNING *
  ),logged AS(
   INSERT INTO audit_logs(actor_id,actor_email,action,before_data,after_data)
   SELECT ${actor.userId},${actor.email},'subscription.plan_updated',to_jsonb(previous),to_jsonb(changed)
   FROM previous JOIN changed USING(id)
  ) SELECT * FROM changed`;
  if(!rows.length)throw new ServiceError('VERSION_CONFLICT',409);
  return rows[0];
 }
 const rows=await sql`WITH created AS(
  INSERT INTO subscription_plans(code,name_ar,name_en,billing_period,currency,price_minor,included_seats,included_projects,features,active)
  VALUES(${c.code},${c.name_ar},${c.name_en},${c.billing_period},${c.currency},${c.price_minor},
  ${c.included_seats},${c.included_projects},${json}::jsonb,${c.active}) RETURNING *
 ), logged AS(
  INSERT INTO audit_logs(actor_id,actor_email,action,after_data)
  SELECT ${actor.userId},${actor.email},'subscription.plan_created',to_jsonb(created) FROM created
 ) SELECT * FROM created`;
 return rows[0];
}
export async function assignSubscription(sql:Sql,actor:Actor,input:unknown){
 await requireOwner(sql,actor);
 const c=assign.parse(input);
 if(c.ends_at&&c.ends_at<=c.starts_at)throw new ServiceError('INVALID_DATE_RANGE',400);
 const plan=(await sql`SELECT * FROM subscription_plans WHERE id=${c.plan_id} AND active`)[0];
 if(!plan)throw new ServiceError('PLAN_UNAVAILABLE',409);
 if(c.seat_limit<plan.included_seats||c.project_limit<plan.included_projects)
  throw new ServiceError('LIMIT_BELOW_PLAN',400);
 // Plan feature, currency, period and amount are copied as an immutable
 // per-company contract snapshot. Catalog changes never rewrite live contracts.
 const values=JSON.stringify(plan.features);
 const rows=await sql`WITH previous AS(
   SELECT * FROM company_subscriptions WHERE company_id=${c.company_id} AND version=${c.version} FOR UPDATE
  ),changed AS(
   INSERT INTO company_subscriptions(company_id,plan_id,status,seat_limit,project_limit,features,currency,
     billing_period,agreed_price_minor,starts_at,ends_at,configured_by)
   SELECT ${c.company_id},${c.plan_id},${c.status},${c.seat_limit},${c.project_limit},
    ${values}::jsonb,${plan.currency},${plan.billing_period},${c.agreed_price_minor},
    ${c.starts_at}::timestamptz,${c.ends_at}::timestamptz,${actor.userId}
   WHERE ${c.version}=0 OR EXISTS(SELECT 1 FROM previous)
   ON CONFLICT(company_id) DO UPDATE SET plan_id=excluded.plan_id,status=excluded.status,
    seat_limit=excluded.seat_limit,project_limit=excluded.project_limit,features=excluded.features,
    currency=excluded.currency,billing_period=excluded.billing_period,agreed_price_minor=excluded.agreed_price_minor,
    starts_at=excluded.starts_at,ends_at=excluded.ends_at,configured_by=excluded.configured_by,
    version=company_subscriptions.version+1,updated_at=now()
    WHERE company_subscriptions.version=${c.version}
   RETURNING *
  ),logged AS(
   INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data)
   SELECT changed.company_id,${actor.userId},${actor.email},'subscription.assigned',
    (SELECT to_jsonb(previous) FROM previous),to_jsonb(changed) FROM changed
  ) SELECT * FROM changed`;
 if(!rows.length)throw new ServiceError('VERSION_CONFLICT',409);
 return rows[0];
}
export async function companySubscription(sql:Sql,actor:Actor,company:string,platform=false){
 const ctx=await access(sql,actor,company,'company.read',platform);
 const canSeePrice=ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'company.write')||hasPermission(ctx.role,ctx.custom,ctx.overrides,'members.manage');
 const [sub,usage]=await Promise.all([
  sql`SELECT s.plan_id,s.status,s.seat_limit,s.project_limit,s.features,s.currency,s.billing_period,s.agreed_price_minor,
   s.starts_at,s.ends_at,s.version FROM company_subscriptions s WHERE s.company_id=${company}`,
  sql`SELECT (SELECT count(*)::int FROM memberships WHERE company_id=${company} AND active) AS active_seats,
   (SELECT count(*)::int FROM projects WHERE company_id=${company}) AS projects,
   (SELECT account_limit FROM companies WHERE id=${company}) AS legacy_seat_limit`
 ]);
 return {subscription:sub[0]?{...sub[0],agreed_price_minor:canSeePrice?sub[0].agreed_price_minor:null}:null,usage:usage[0]};
}
export async function requireFeature(sql:Sql,company:string,feature:Feature,platform=false){
 if(platform)return; // Verified owner privileges were checked by access() already.
 // Caller must have already passed normal service permission checks.
 // Legacy companies have no subscription yet; no new restrictions applied.
 const rows=await sql`SELECT status,features FROM company_subscriptions WHERE company_id=${company}`;
 if(!rows.length)return;
 if(rows[0].status==='suspended')throw new ServiceError('SUBSCRIPTION_SUSPENDED',403);
 if(rows[0].features?.[feature]!==true)throw new ServiceError('FEATURE_NOT_IN_PLAN',403);
}
