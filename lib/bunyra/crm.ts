import { z } from 'zod';
import { LEAD_STAGES, stageLabel, terminalStage } from './lead-stages';
import {repeatKind,localDue} from './follow-ups';
import {hasPermission} from './permissions';
import {crmScope,requireCustomer,requireLead} from './crm-scope';
import {salesScope,projectAllowed} from './record-scope';
import { access, type Actor, type Sql, ServiceError, uuid } from './service';

const email = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const phone = z.string().trim().min(3).max(40);
const customerInput = z.object({
  company_id: uuid,
  full_name: z.string().trim().min(2).max(160),
  phone,
  national_id: z.string().trim().max(30).regex(/^[0-9A-Za-z -]*$/).default(''),
  email: z.union([email, z.literal('')]).default(''),
  address: z.string().trim().max(500).default(''),
  notes: z.string().trim().max(5000).default(''),
});
const leadInput = z.object({
  company_id: uuid,
  customer_id: uuid,
  source: z.string().trim().min(2).max(80),
  status: z.enum(['new','contacted','qualified','proposal','won','lost','paused']).default('new'),
  stage_code:z.enum(LEAD_STAGES.map(s=>s[0]) as [typeof LEAD_STAGES[number][0],...typeof LEAD_STAGES[number][0][]]).optional(),
  owner_user_id: z.string().min(1).max(200).optional(),
  project_id: uuid.nullable().default(null),
  interest: z.string().trim().max(1000).default(''),
  lost_reason: z.string().trim().max(500).default(''),
});
const interactionInput = z.object({
  company_id: uuid,
  customer_id: uuid,
  lead_id: uuid.nullable().default(null),
  kind: z.enum(['call','meeting','whatsapp','email','note']),
  body: z.string().trim().min(1).max(3000),
});
const followUpInput = z.object({
  company_id: uuid,
  customer_id: uuid,
  lead_id: uuid.nullable().default(null),
  due_at: z.string().datetime().optional(),due_local:localDue.optional(),repeat_kind:repeatKind.default('none'),repeat_every:z.number().int().min(1).max(12).default(1),
  title: z.string().trim().min(2).max(160),
  assigned_to: z.string().min(1).max(200).optional(),
});
const updateLeadInput = z.object({
  company_id: uuid,
  id: uuid,
  version: z.number().int().positive(),
  status: z.enum(['new','contacted','qualified','proposal','won','lost','paused']).optional(),
  owner_user_id: z.string().min(1).max(200).optional(),
  project_id: uuid.nullable().optional(),
  interest: z.string().trim().max(1000).optional(),
  lost_reason: z.string().trim().max(500).optional(),
});

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, '').replace(/^00/, '+');
}
function normalizeEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}
async function ensureOwner(sql: Sql, companyId: string, userId: string) {
  if (!(await sql`SELECT 1 FROM memberships WHERE company_id=${companyId} AND user_id=${userId} AND active`).length) {
    throw new ServiceError('INVALID_OWNER', 400);
  }
}
async function ensureCustomer(sql: Sql, companyId: string, customerId: string) {
  if (!(await sql`SELECT 1 FROM crm_customers WHERE company_id=${companyId} AND id=${customerId}`).length) {
    throw new ServiceError('INVALID_CUSTOMER', 400);
  }
}

export async function crmOverview(sql: Sql, actor: Actor, companyId: string, options: { customer?:string; q?: string; status?: string; owner?: string; asOwner?: boolean } = {}) {
  const {ctx,ids,customerIds,users}=await crmScope(sql,actor,companyId,'leads.read',options.asOwner===true);
  const customer=options.customer?uuid.parse(options.customer):null;
  const q = (options.q || '').trim().slice(0, 120);
  const status = options.status || '';
  const owner = options.owner || '';
  const [customers, stats, projects, members, interactions, followUps] = await Promise.all([
    sql`SELECT c.id,c.full_name,c.phone,c.email,c.address,c.notes,c.version,c.created_at,c.updated_at,
      COALESCE(json_agg(json_build_object('id',l.id,'status',l.status,'stage_code',l.stage_code,'stage_changed_at',l.stage_changed_at,'created_at',l.created_at,'source',l.source,'owner_user_id',l.owner_user_id,'project_id',l.project_id,'project_name',p.name,'version',l.version,'updated_at',l.updated_at,
       'last_action',(SELECT json_build_object('body',i.body,'at',i.created_at) FROM crm_interactions i WHERE i.company_id=l.company_id AND i.lead_id=l.id ORDER BY i.created_at DESC,i.id DESC LIMIT 1),
       'next_follow_up',(SELECT json_build_object('id',f.id,'title',f.title,'due_at',f.due_at) FROM crm_follow_ups f WHERE f.company_id=l.company_id AND f.lead_id=l.id AND f.status='open' AND (${users===null} OR f.assigned_to=ANY(${users||[]}::text[])) ORDER BY f.due_at,f.id LIMIT 1)
      ) ORDER BY l.updated_at DESC) FILTER (WHERE l.id IS NOT NULL),'[]') AS leads
      FROM crm_customers c LEFT JOIN crm_leads l ON l.company_id=c.company_id AND l.customer_id=c.id AND l.id=ANY(${ids}::uuid[]) LEFT JOIN projects p ON p.company_id=l.company_id AND p.id=l.project_id
      WHERE c.company_id=${companyId} AND (${customer}::uuid IS NULL OR c.id=${customer}::uuid) AND c.id=ANY(${customerIds}::uuid[]) AND (${q}='' OR c.full_name ILIKE ${'%' + q + '%'} OR c.phone ILIKE ${'%' + q + '%'} OR c.email ILIKE ${'%' + q + '%'})
      GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 200`,
    sql`SELECT count(*)::int AS customers,
      (SELECT count(*)::int FROM crm_leads WHERE company_id=${companyId} AND id=ANY(${ids}::uuid[]) AND status NOT IN('won','lost')) AS open_leads,
      (SELECT count(*)::int FROM crm_follow_ups WHERE company_id=${companyId} AND customer_id=ANY(${customerIds}::uuid[]) AND (${users===null} OR assigned_to=ANY(${users||[]}::text[])) AND status='open' AND due_at<now()) AS overdue_follow_ups,
      (SELECT count(*)::int FROM crm_leads WHERE company_id=${companyId} AND id=ANY(${ids}::uuid[]) AND status='won') AS won_leads
      FROM crm_customers WHERE company_id=${companyId} AND id=ANY(${customerIds}::uuid[])`,
    sql`SELECT id,name FROM projects WHERE company_id=${companyId} ORDER BY name`,
    sql`SELECT user_id,email,role FROM memberships WHERE company_id=${companyId} AND active ORDER BY email`,
    sql`SELECT i.id,i.customer_id,i.lead_id,i.kind,i.body,i.created_by,i.created_at,c.full_name FROM crm_interactions i JOIN crm_customers c ON c.company_id=i.company_id AND c.id=i.customer_id WHERE i.company_id=${companyId} AND (${customer}::uuid IS NULL OR i.customer_id=${customer}::uuid) AND i.customer_id=ANY(${customerIds}::uuid[]) AND (i.lead_id=ANY(${ids}::uuid[]) OR (i.lead_id IS NULL AND (${users===null} OR i.created_by=ANY(${users||[]}::text[]) OR EXISTS(SELECT 1 FROM crm_leads owned JOIN crm_lead_transfers handoff ON handoff.company_id=owned.company_id AND handoff.lead_id=owned.id AND handoff.to_user_id=owned.owner_user_id WHERE owned.company_id=i.company_id AND owned.customer_id=i.customer_id AND owned.id=ANY(${ids}::uuid[]))))) ORDER BY i.created_at DESC LIMIT 40`,
    sql`SELECT f.id,f.customer_id,f.lead_id,f.due_at,f.title,f.status,f.assigned_to,f.created_at,c.full_name FROM crm_follow_ups f JOIN crm_customers c ON c.company_id=f.company_id AND c.id=f.customer_id WHERE f.company_id=${companyId} AND (${customer}::uuid IS NULL OR f.customer_id=${customer}::uuid) AND f.customer_id=ANY(${customerIds}::uuid[]) AND (${users===null} OR f.assigned_to=ANY(${users||[]}::text[])) AND (f.lead_id IS NULL OR f.lead_id=ANY(${ids}::uuid[])) AND (${owner}='' OR f.assigned_to=${owner}) ORDER BY f.status='open' DESC,f.due_at ASC LIMIT 100`,
  ]);
  const filtered = customers.map(row => ({ ...row, leads: (row.leads || []).filter((lead: {status: string; owner_user_id: string}) => (!status || lead.status === status) && (!owner || lead.owner_user_id === owner)) }));
  const autoAssignAvailable = !ctx.owner && ctx.role==='company_admin' && hasPermission(ctx.role,ctx.custom,ctx.overrides,'members.manage');
  const routing = autoAssignAvailable ? (await sql`SELECT enabled FROM crm_lead_routing_settings WHERE company_id=${companyId}`)[0] : null;
  const timeZone=(await sql`SELECT COALESCE((SELECT time_zone FROM company_settings WHERE company_id=${companyId}),'Africa/Cairo') AS zone`)[0].zone;
  return { ...ctx,time_zone:timeZone, can_assign:projectAllowed(ctx,'leads.write')&&(ctx.owner||['company_admin','sales_manager','sales_admin','operations'].includes(ctx.role)), can_write:projectAllowed(ctx,'leads.write'), auto_assign_available:autoAssignAvailable, auto_assign_enabled:routing?.enabled===true, customers: filtered.map(c=>({...c,leads:c.leads.map((l: {project_id:string|null})=>({...l,can_write:projectAllowed(ctx,'leads.write',l.project_id)}))})), stats: stats[0], projects:projects.filter(p=>projectAllowed(ctx,'leads.read',p.id)), members:members.filter(m=>!users||users.includes(m.user_id)), interactions, followUps };
}

const leadActionInput=z.object({company_id:uuid,id:uuid,version:z.number().int().positive(),
 stage_code:z.enum(LEAD_STAGES.map(s=>s[0]) as [typeof LEAD_STAGES[number][0],...typeof LEAD_STAGES[number][0][]]),
 body:z.string().trim().min(2).max(2800),answered:z.boolean(),due_local:localDue.optional()}).strict();

/** One version-checked write records the stage, outcome and next action together. */
export async function recordLeadAction(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=leadActionInput.parse(input),scope=await requireLead(sql,actor,c.company_id,c.id,platform);
 if(!terminalStage(c.stage_code)&&!c.due_local)throw new ServiceError('FOLLOW_UP_DATE_REQUIRED');
 let due:string|null=null;
 if(c.due_local){
  const d=(await sql`SELECT (${c.due_local}::timestamp AT TIME ZONE COALESCE((SELECT time_zone FROM company_settings WHERE company_id=${c.company_id}),'Africa/Cairo')) AS due,
   to_char((${c.due_local}::timestamp AT TIME ZONE COALESCE((SELECT time_zone FROM company_settings WHERE company_id=${c.company_id}),'Africa/Cairo')) AT TIME ZONE COALESCE((SELECT time_zone FROM company_settings WHERE company_id=${c.company_id}),'Africa/Cairo'),'YYYY-MM-DD"T"HH24:MI')=${c.due_local} AND (${c.due_local}::timestamp AT TIME ZONE COALESCE((SELECT time_zone FROM company_settings WHERE company_id=${c.company_id}),'Africa/Cairo'))>now() AS valid`)[0];
  if(!d.valid)throw new ServiceError('INVALID_FOLLOW_UP_DATE');due=d.due;
 }
 const outcome=`${stageLabel(c.stage_code,true)} · ${c.answered?'Answered':'No answer'}\n${c.body}`;
 const rows=await sql`WITH previous AS(SELECT * FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.id} AND version=${c.version} AND owner_user_id=${scope.row.owner_user_id} FOR UPDATE),
 changed AS(UPDATE crm_leads SET stage_code=${c.stage_code},stage_changed_at=COALESCE(stage_changed_at,now()),version=version+1,updated_at=now() WHERE company_id=${c.company_id} AND id IN(SELECT id FROM previous) RETURNING *),
 interaction AS(INSERT INTO crm_interactions(company_id,customer_id,lead_id,kind,body,created_by) SELECT company_id,customer_id,id,'call',${outcome},${actor.userId} FROM changed RETURNING id),
 replaced AS(UPDATE crm_follow_ups f SET status='cancelled',version=f.version+1 WHERE f.company_id=${c.company_id} AND f.lead_id IN(SELECT id FROM changed) AND f.lead_action AND f.status='open' RETURNING f.*),
 next_action AS(INSERT INTO crm_follow_ups(company_id,customer_id,lead_id,title,due_at,assigned_to,created_by,lead_action) SELECT company_id,customer_id,id,${stageLabel(c.stage_code,true)},${due}::timestamptz,owner_user_id,${actor.userId},true FROM changed WHERE ${due}::timestamptz IS NOT NULL RETURNING id),
 logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'crm.lead_action_recorded',to_jsonb(p),to_jsonb(n)||jsonb_build_object('answered',${c.answered}::boolean,'next_due_at',${due}::text,'interaction_id',(SELECT id FROM interaction),'replaced_follow_ups',(SELECT COALESCE(jsonb_agg(r),'[]') FROM replaced r)) FROM previous p JOIN changed n USING(id)) SELECT * FROM changed`;
 if(!rows.length)throw new ServiceError('VERSION_CONFLICT',409);
 return rows[0];
}

export async function createCustomer(sql: Sql, actor: Actor, input: unknown, asOwner = false, initializeStage = false) {
  const c = customerInput.parse(input);
  await access(sql, actor, c.company_id, 'leads.write', asOwner);
  const normalizedPhone = normalizePhone(c.phone);
  if (!normalizedPhone) throw new ServiceError('INVALID_PHONE');
  const normalizedEmail = normalizeEmail(c.email);
  const rows = await sql.transaction([
    sql`INSERT INTO crm_customers(company_id,full_name,phone,email,address,notes,national_id,normalized_phone,normalized_email,created_by) VALUES(${c.company_id},${c.full_name}::text,${c.phone}::text,${c.email}::text,${c.address}::text,${c.notes}::text,${c.national_id||null}::text,${normalizedPhone}::text,${normalizedEmail}::text,${actor.userId}::text) RETURNING id,full_name,phone,email,address,notes,version,created_at,updated_at`,
    ...(initializeStage ? [
      sql`INSERT INTO crm_leads(company_id,customer_id,source,status,owner_user_id,created_by,stage_code,stage_changed_at)
           SELECT ${c.company_id}::uuid,id,'customer_record','new',${actor.userId}::text,${actor.userId}::text,'fresh',now()
           FROM crm_customers WHERE company_id=${c.company_id} AND normalized_phone=${normalizedPhone}
           RETURNING id`
    ] : []),
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.customer_created',jsonb_build_object('full_name',${c.full_name}::text,'phone',${c.phone}::text,'email',${c.email}::text)) RETURNING id`,
  ]);
  return rows[0][0];
}

export async function createLead(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = leadInput.parse(input);
  const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  const requestedOwner = c.owner_user_id || actor.userId;
  // Routing is opt-in for admin-created leads only. A seller always owns the lead
  // they create unless an authorized manager explicitly selects an owner.
  const autoEligible = !c.owner_user_id && !ctx.owner && ctx.role === 'company_admin' && hasPermission(ctx.role,ctx.custom,ctx.overrides,'members.manage');
  await ensureCustomer(sql, c.company_id, c.customer_id);
  await requireCustomer(sql,actor,c.company_id,c.customer_id,'leads.write',asOwner);
  const scope = await crmScope(sql,actor,c.company_id,'leads.write',asOwner);
  if(scope.users && !scope.users.includes(requestedOwner))throw new ServiceError('FORBIDDEN',403);
  if(c.project_id && !projectAllowed(scope.ctx,'leads.write',c.project_id))throw new ServiceError('FORBIDDEN',403);
  if(!autoEligible)await ensureOwner(sql, c.company_id, requestedOwner);
  if(c.project_id && !(await sql`SELECT 1 FROM projects WHERE company_id=${c.company_id} AND id=${c.project_id}`).length)throw new ServiceError('INVALID_PROJECT');
  // Routing, lead creation and audit are one SQL statement. A failed write
  // rolls back the routing cursor; a row lock inside the function avoids
  // duplicate allocation under concurrent requests.
  const rows = await sql`
   WITH routed AS MATERIALIZED (
    SELECT CASE WHEN ${autoEligible}::boolean
      THEN bunyra_route_lead_owner(${c.company_id}::uuid,${c.project_id}::uuid,${requestedOwner}::text)
      ELSE ${requestedOwner}::text END AS owner_id,
      CASE WHEN ${autoEligible}::boolean AND EXISTS(SELECT 1 FROM crm_lead_routing_settings WHERE company_id=${c.company_id} AND enabled)
        THEN 'round_robin' ELSE 'manual' END AS assignment
   ), created AS (
    INSERT INTO crm_leads(company_id,customer_id,source,status,owner_user_id,project_id,interest,lost_reason,created_by,stage_id,stage_code)
    SELECT ${c.company_id}::uuid,${c.customer_id}::uuid,${c.source}::text,${c.status}::text,routed.owner_id,${c.project_id}::uuid,${c.interest}::text,${c.lost_reason}::text,${actor.userId}::text,
    (SELECT id FROM crm_pipeline_stages WHERE company_id=${c.company_id} AND active ORDER BY position LIMIT 1),${c.stage_code??null}::text
    FROM routed RETURNING *
   ), logged AS (
    INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
    SELECT ${c.company_id}::uuid,${actor.userId}::text,${actor.email}::text,'crm.lead_created',
    jsonb_build_object('customer_id',created.customer_id,'owner_user_id',created.owner_user_id,'status',created.status,'assignment',routed.assignment)
    FROM created CROSS JOIN routed
   ) SELECT * FROM created`;
  if(!rows.length)throw new ServiceError('LEAD_CREATE_FAILED',409);
  return rows[0];
}
export async function updateLead(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = updateLeadInput.parse(input);
  await access(sql, actor, c.company_id, 'leads.write', asOwner);
  const ctx=await access(sql,actor,c.company_id,'leads.write',asOwner);
  const previous=(await sql`SELECT * FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.id}`)[0];
  if(!previous)throw new ServiceError('NOT_FOUND',404);
  const users=await salesScope(sql,actor,c.company_id,ctx);
  if((users&&!users.includes(previous.owner_user_id))||!projectAllowed(ctx,'leads.write',previous.project_id))throw new ServiceError('FORBIDDEN',403);
  if(c.owner_user_id&&c.owner_user_id!==previous.owner_user_id)throw new ServiceError('USE_LEAD_TRANSFER',403);
  if(c.project_id&&!projectAllowed(ctx,'leads.write',c.project_id))throw new ServiceError('FORBIDDEN',403);
  if (c.project_id && !(await sql`SELECT 1 FROM projects WHERE company_id=${c.company_id} AND id=${c.project_id}`).length) throw new ServiceError('INVALID_PROJECT');
  const rows = await sql`WITH previous AS(SELECT * FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.id} AND version=${c.version} FOR UPDATE), changed AS(UPDATE crm_leads SET status=COALESCE(${c.status ?? null},status),owner_user_id=COALESCE(${c.owner_user_id ?? null},owner_user_id),project_id=CASE WHEN ${c.project_id === undefined} THEN project_id ELSE ${c.project_id} END,interest=COALESCE(${c.interest ?? null},interest),lost_reason=COALESCE(${c.lost_reason ?? null},lost_reason),version=version+1,updated_at=now() WHERE company_id=${c.company_id} AND id IN(SELECT id FROM previous) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'crm.lead_updated',to_jsonb(previous),to_jsonb(changed) FROM previous JOIN changed USING(id)) SELECT * FROM changed`;
  if (!rows.length) throw new ServiceError('VERSION_CONFLICT', 409);
  return rows[0];
}

export async function addInteraction(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = interactionInput.parse(input);
  await access(sql, actor, c.company_id, 'leads.write', asOwner);
  await ensureCustomer(sql, c.company_id, c.customer_id);
  await requireCustomer(sql,actor,c.company_id,c.customer_id,'leads.write',asOwner);
  if(c.lead_id)await requireLead(sql,actor,c.company_id,c.lead_id,asOwner);
  if (c.lead_id && !(await sql`SELECT 1 FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.lead_id} AND customer_id=${c.customer_id}`).length) throw new ServiceError('INVALID_LEAD');
  const rows = await sql.transaction([
    sql`INSERT INTO crm_interactions(company_id,customer_id,lead_id,kind,body,created_by) VALUES(${c.company_id},${c.customer_id},${c.lead_id}::uuid,${c.kind}::text,${c.body}::text,${actor.userId}::text) RETURNING *`,
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.interaction_added',jsonb_build_object('customer_id',${c.customer_id}::text,'kind',${c.kind}::text)) RETURNING id`,
  ]);
  return rows[0][0];
}

export async function addFollowUp(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = followUpInput.refine(v=>Boolean(v.due_at)!==Boolean(v.due_local),'Provide one due date').parse(input);
  await access(sql, actor, c.company_id, 'leads.write', asOwner);
  await ensureCustomer(sql, c.company_id, c.customer_id);
  await requireCustomer(sql,actor,c.company_id,c.customer_id,'leads.write',asOwner);
  const assignedTo = c.assigned_to || actor.userId;
  const scope=await crmScope(sql,actor,c.company_id,'leads.write',asOwner);if(scope.users&&!scope.users.includes(assignedTo))throw new ServiceError('FORBIDDEN',403);
  await ensureOwner(sql, c.company_id, assignedTo);
  if(c.lead_id)await requireLead(sql,actor,c.company_id,c.lead_id,asOwner);
  if (c.lead_id && !(await sql`SELECT 1 FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.lead_id} AND customer_id=${c.customer_id}`).length) throw new ServiceError('INVALID_LEAD');
  let due=c.due_at;
  if(c.due_local){const row=(await sql`SELECT (${c.due_local}::timestamp AT TIME ZONE COALESCE((SELECT time_zone FROM company_settings WHERE company_id=${c.company_id}),'Africa/Cairo')) AS due,
  to_char((${c.due_local}::timestamp AT TIME ZONE COALESCE((SELECT time_zone FROM company_settings WHERE company_id=${c.company_id}),'Africa/Cairo')) AT TIME ZONE COALESCE((SELECT time_zone FROM company_settings WHERE company_id=${c.company_id}),'Africa/Cairo'),'YYYY-MM-DD"T"HH24:MI')=${c.due_local} AS valid`)[0];if(!row.valid)throw new ServiceError('INVALID_FOLLOW_UP_DATE',400);due=row.due;}
  const rows=await sql`WITH created AS(
   INSERT INTO crm_follow_ups(company_id,customer_id,lead_id,due_at,title,assigned_to,created_by,repeat_kind,repeat_every)
   VALUES(${c.company_id},${c.customer_id},${c.lead_id}::uuid,${due}::timestamptz,${c.title}::text,${assignedTo}::text,${actor.userId}::text,${c.repeat_kind},${c.repeat_every}) RETURNING *
  ),logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'crm.follow_up_created',to_jsonb(created) FROM created) SELECT * FROM created`;
  return rows[0];
}
