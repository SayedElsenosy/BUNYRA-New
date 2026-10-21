import {z} from 'zod';
import {owner,access,ServiceError,uuid,type Actor,type Sql} from './service';
import {bindTenant} from './tenant';

export const FEATURE_KEYS=['deals_insights','report_exports','interactive_plans','buyer_matching','commission_reports','finance_erp'] as const;
export type FeatureKey=typeof FEATURE_KEYS[number];
const features=z.object(Object.fromEntries(FEATURE_KEYS.map(k=>[k,z.boolean().default(false)])) as Record<FeatureKey,z.ZodDefault<z.ZodBoolean>>).strict();
const planCore=z.object({
 code:z.string().regex(/^[a-z][a-z0-9_-]{2,39}$/),name_ar:z.string().trim().min(2).max(100),name_en:z.string().trim().min(2).max(100),
 active:z.boolean().default(true),currency:z.string().regex(/^[A-Z]{3}$/).default('EGP'),
 monthly_base_minor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
 annual_base_minor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
 included_seats:z.number().int().min(1).max(10000),
 monthly_extra_seat_minor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
 annual_extra_seat_minor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
 max_projects:z.number().int().min(1).max(100000).nullable().default(null),
 max_units:z.number().int().min(1).max(10000000).nullable().default(null),
 features
});
const planInput=planCore.extend({id:uuid.optional(),version:z.number().int().positive().optional()}).strict();
const assignmentInput=z.object({
 company_id:uuid,plan_id:uuid,cycle:z.enum(['monthly','annual']),
 extra_seats:z.number().int().min(0).max(9999).default(0),
 status:z.enum(['active','grace','billing_suspended','cancelled']).default('active'),
 grace_until:z.string().datetime().nullable().default(null),
 renews_at:z.string().datetime().nullable().default(null),
 version:z.number().int().positive().optional()
}).strict();

async function requireOwner(sql:Sql,actor:Actor){bindTenant(sql,null);if(!await owner(sql,actor))throw new ServiceError('FORBIDDEN',403);}
export async function listPlanCatalog(sql:Sql,actor:Actor){
 await requireOwner(sql,actor);
 const [plans,subscriptions,companies]=await Promise.all([
  sql`SELECT * FROM saas_plans ORDER BY created_at,code`,
  sql`SELECT s.*,p.code AS plan_code,c.name AS company_name FROM company_subscriptions s JOIN saas_plans p ON p.id=s.plan_id JOIN companies c ON c.id=s.company_id ORDER BY c.name`,
  sql`SELECT id,name,account_limit,(SELECT count(*)::int FROM memberships m WHERE m.company_id=c.id AND m.active) AS active_seats,(SELECT count(*)::int FROM invitations i WHERE i.company_id=c.id AND i.status='pending' AND i.expires_at>now() AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=i.company_id AND m.active AND lower(m.email)=i.email)) AS reserved_seats FROM companies c WHERE status<>'deleted' ORDER BY name`
 ]);
 return {plans,subscriptions,companies};
}
export async function savePlan(sql:Sql,actor:Actor,input:unknown){
 await requireOwner(sql,actor);const p=planInput.parse(input);
 if(p.id!==undefined&&!p.version)throw new ServiceError('VERSION_REQUIRED',400);
 const f=JSON.stringify(p.features);
 const rows=p.id?await sql`WITH previous AS(
  SELECT * FROM saas_plans WHERE id=${p.id} AND version=${p.version} FOR UPDATE
 ),changed AS(
  UPDATE saas_plans SET name_ar=${p.name_ar},name_en=${p.name_en},active=${p.active},
   currency=${p.currency},monthly_base_minor=${p.monthly_base_minor},annual_base_minor=${p.annual_base_minor},
   included_seats=${p.included_seats},monthly_extra_seat_minor=${p.monthly_extra_seat_minor},
   annual_extra_seat_minor=${p.annual_extra_seat_minor},max_projects=${p.max_projects},max_units=${p.max_units},
   features=${f}::jsonb,version=version+1,updated_at=now()
  WHERE id IN(SELECT id FROM previous) RETURNING *
 ),logged AS(INSERT INTO audit_logs(actor_id,actor_email,action,before_data,after_data)
  SELECT ${actor.userId},${actor.email},'saas.plan_updated',to_jsonb(previous),to_jsonb(changed)
  FROM previous JOIN changed USING(id))
 SELECT * FROM changed`:
 await sql`WITH created AS(
  INSERT INTO saas_plans(code,name_ar,name_en,active,currency,monthly_base_minor,annual_base_minor,included_seats,
   monthly_extra_seat_minor,annual_extra_seat_minor,max_projects,max_units,features)
  VALUES(${p.code},${p.name_ar},${p.name_en},${p.active},${p.currency},${p.monthly_base_minor},
   ${p.annual_base_minor},${p.included_seats},${p.monthly_extra_seat_minor},${p.annual_extra_seat_minor},
   ${p.max_projects},${p.max_units},${f}::jsonb) RETURNING *
 ),logged AS(INSERT INTO audit_logs(actor_id,actor_email,action,after_data) SELECT
  ${actor.userId},${actor.email},'saas.plan_created',to_jsonb(created) FROM created)
 SELECT * FROM created`;
 if(!rows.length)throw new ServiceError('VERSION_CONFLICT',409);
 return rows[0];
}
export async function assignPlan(sql:Sql,actor:Actor,input:unknown){
 await requireOwner(sql,actor);const a=assignmentInput.parse(input);
 if(a.status==='grace'&&!a.grace_until)throw new ServiceError('GRACE_DATE_REQUIRED',400);
 if(a.grace_until&&a.renews_at&&a.grace_until<a.renews_at)throw new ServiceError('INVALID_GRACE_DATE',400);
 const plan=(await sql`SELECT * FROM saas_plans WHERE id=${a.plan_id} AND active`)[0];
 if(!plan)throw new ServiceError('PLAN_NOT_AVAILABLE',409);
 const seatLimit=Number(plan.included_seats)+a.extra_seats;
 if(seatLimit>10000)throw new ServiceError('SEAT_LIMIT_TOO_LARGE',400);
 const current=(await sql`SELECT version FROM company_subscriptions WHERE company_id=${a.company_id}`)[0];
 if(current&&current.version!==a.version)throw new ServiceError('VERSION_CONFLICT',409);
 if(!current&&a.version!==undefined)throw new ServiceError('VERSION_CONFLICT',409);
 const price=a.cycle==='annual'?plan.annual_base_minor:plan.monthly_base_minor;
 const seatPrice=a.cycle==='annual'?plan.annual_extra_seat_minor:plan.monthly_extra_seat_minor;
 const result=await sql.transaction([
  sql`SELECT id FROM companies WHERE id=${a.company_id} AND status<>'deleted' FOR UPDATE`,
  sql`WITH prior AS(SELECT * FROM company_subscriptions WHERE company_id=${a.company_id}),
  changed AS(
   INSERT INTO company_subscriptions(company_id,plan_id,status,cycle,included_seats,extra_seats,
    max_projects,max_units,features,currency,base_price_minor,extra_seat_price_minor,
    grace_until,renews_at,changed_by)
   SELECT ${a.company_id},${a.plan_id},${a.status},${a.cycle},${plan.included_seats},
    ${a.extra_seats},${plan.max_projects},${plan.max_units},${JSON.stringify(plan.features)}::jsonb,
    ${plan.currency},${price},${seatPrice},${a.grace_until},${a.renews_at},${actor.userId}
   WHERE EXISTS(SELECT 1 FROM companies WHERE id=${a.company_id} AND status<>'deleted')
   ON CONFLICT(company_id) DO UPDATE SET plan_id=excluded.plan_id,status=excluded.status,cycle=excluded.cycle,
    included_seats=excluded.included_seats,extra_seats=excluded.extra_seats,max_projects=excluded.max_projects,
    max_units=excluded.max_units,features=excluded.features,currency=excluded.currency,
    base_price_minor=excluded.base_price_minor,extra_seat_price_minor=excluded.extra_seat_price_minor,
    grace_until=excluded.grace_until,renews_at=excluded.renews_at,changed_by=excluded.changed_by,
    version=company_subscriptions.version+1,updated_at=now()
   WHERE company_subscriptions.version=${a.version}::int
       OR ${a.version}::int IS NULL AND company_subscriptions.version=1 AND false
   RETURNING *
  ),logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data)
    SELECT changed.company_id,${actor.userId},${actor.email},'saas.subscription_assigned',
    (SELECT to_jsonb(prior) FROM prior),to_jsonb(changed) FROM changed)
  SELECT * FROM changed`
 ]);
 if(!result[1].length)throw new ServiceError('VERSION_CONFLICT',409);
 return result[1][0];
}
export async function companyEntitlements(sql:Sql,actor:Actor,companyId:string,platform=false){
 await access(sql,actor,companyId,'company.read',platform);
 const rows=await sql`SELECT s.company_id,s.status,s.cycle,s.included_seats,s.extra_seats,s.max_projects,s.max_units,
 s.features,s.currency,s.base_price_minor,s.extra_seat_price_minor,s.renews_at,s.grace_until,
 (SELECT count(*)::int FROM memberships WHERE company_id=s.company_id AND active) AS active_seats,
 (SELECT count(*)::int FROM invitations i WHERE i.company_id=s.company_id AND i.status='pending'
   AND i.expires_at>now() AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=i.company_id AND m.active AND lower(m.email)=i.email)) AS reserved_seats
 FROM company_subscriptions s WHERE s.company_id=${companyId}`;
 return rows[0]||null;
}
export async function requireEntitlement(sql:Sql,actor:Actor,companyId:string,feature:FeatureKey,platform=false){
 // Platform-owner maintenance retains read access; company assignments are
 // opt-in, so unassigned legacy tenants are not accidentally restricted.
 await access(sql,actor,companyId,'company.read',platform);
 if(platform)return;
 const rows=await sql`SELECT status,features FROM company_subscriptions WHERE company_id=${companyId}`;
 if(!rows.length)return;
 if(rows[0].status==='billing_suspended'||rows[0].status==='cancelled')throw new ServiceError('SUBSCRIPTION_INACTIVE',403);
 if(rows[0].features?.[feature]!==true)throw new ServiceError('FEATURE_NOT_INCLUDED',403);
}
