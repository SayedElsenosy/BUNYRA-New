import { z } from 'zod';
import { access, type Actor, type Sql, ServiceError, uuid } from './service';

const email = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const phone = z.string().trim().min(3).max(40);
const customerInput = z.object({
  company_id: uuid,
  full_name: z.string().trim().min(2).max(160),
  phone,
  email: z.union([email, z.literal('')]).default(''),
  address: z.string().trim().max(500).default(''),
  notes: z.string().trim().max(5000).default(''),
});
const leadInput = z.object({
  company_id: uuid,
  customer_id: uuid,
  source: z.string().trim().min(2).max(80),
  status: z.enum(['new','contacted','qualified','proposal','won','lost','paused']).default('new'),
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
  due_at: z.string().datetime(),
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

export async function crmOverview(sql: Sql, actor: Actor, companyId: string, options: { q?: string; status?: string; owner?: string; asOwner?: boolean } = {}) {
  const ctx = await access(sql, actor, companyId, 'leads.read', options.asOwner === true);
  const q = (options.q || '').trim().slice(0, 120);
  const status = options.status || '';
  const owner = options.owner || '';
  const [customers, stats, projects, members, interactions, followUps] = await Promise.all([
    sql`SELECT c.id,c.full_name,c.phone,c.email,c.address,c.notes,c.version,c.created_at,c.updated_at,
      COALESCE(json_agg(json_build_object('id',l.id,'status',l.status,'source',l.source,'owner_user_id',l.owner_user_id,'project_id',l.project_id,'project_name',p.name,'version',l.version,'updated_at',l.updated_at) ORDER BY l.updated_at DESC) FILTER (WHERE l.id IS NOT NULL),'[]') AS leads
      FROM crm_customers c LEFT JOIN crm_leads l ON l.company_id=c.company_id AND l.customer_id=c.id LEFT JOIN projects p ON p.company_id=l.company_id AND p.id=l.project_id
      WHERE c.company_id=${companyId} AND (${q}='' OR c.full_name ILIKE ${'%' + q + '%'} OR c.phone ILIKE ${'%' + q + '%'} OR c.email ILIKE ${'%' + q + '%'})
      GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 200`,
    sql`SELECT count(*)::int AS customers,
      (SELECT count(*)::int FROM crm_leads WHERE company_id=${companyId} AND status NOT IN('won','lost')) AS open_leads,
      (SELECT count(*)::int FROM crm_follow_ups WHERE company_id=${companyId} AND status='open' AND due_at<now()) AS overdue_follow_ups,
      (SELECT count(*)::int FROM crm_leads WHERE company_id=${companyId} AND status='won') AS won_leads
      FROM crm_customers WHERE company_id=${companyId}`,
    sql`SELECT id,name FROM projects WHERE company_id=${companyId} ORDER BY name`,
    sql`SELECT user_id,email,role FROM memberships WHERE company_id=${companyId} AND active ORDER BY email`,
    sql`SELECT i.id,i.customer_id,i.lead_id,i.kind,i.body,i.created_by,i.created_at,c.full_name FROM crm_interactions i JOIN crm_customers c ON c.company_id=i.company_id AND c.id=i.customer_id WHERE i.company_id=${companyId} ORDER BY i.created_at DESC LIMIT 40`,
    sql`SELECT f.id,f.customer_id,f.lead_id,f.due_at,f.title,f.status,f.assigned_to,f.created_at,c.full_name FROM crm_follow_ups f JOIN crm_customers c ON c.company_id=f.company_id AND c.id=f.customer_id WHERE f.company_id=${companyId} AND (${owner}='' OR f.assigned_to=${owner}) ORDER BY f.status='open' DESC,f.due_at ASC LIMIT 100`,
  ]);
  const filtered = customers.map(row => ({ ...row, leads: (row.leads || []).filter((lead: {status: string; owner_user_id: string}) => (!status || lead.status === status) && (!owner || lead.owner_user_id === owner)) }));
  return { ...ctx, customers: filtered, stats: stats[0], projects, members, interactions, followUps };
}

export async function createCustomer(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = customerInput.parse(input);
  await access(sql, actor, c.company_id, 'leads.write', asOwner);
  const normalizedPhone = normalizePhone(c.phone);
  if (!normalizedPhone) throw new ServiceError('INVALID_PHONE');
  const normalizedEmail = normalizeEmail(c.email);
  const rows = await sql.transaction([
    sql`INSERT INTO crm_customers(company_id,full_name,phone,email,address,notes,normalized_phone,normalized_email,created_by) VALUES(${c.company_id},${c.full_name},${c.phone},${c.email},${c.address},${c.notes},${normalizedPhone},${normalizedEmail},${actor.userId}) RETURNING id,full_name,phone,email,address,notes,version,created_at,updated_at`,
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.customer_created',jsonb_build_object('full_name',${c.full_name},'phone',${c.phone},'email',${c.email})) RETURNING id`,
  ]);
  return rows[0][0];
}

export async function createLead(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = leadInput.parse(input);
  await access(sql, actor, c.company_id, 'leads.write', asOwner);
  const ownerId = c.owner_user_id || actor.userId;
  await ensureCustomer(sql, c.company_id, c.customer_id);
  await ensureOwner(sql, c.company_id, ownerId);
  if (c.project_id && !(await sql`SELECT 1 FROM projects WHERE company_id=${c.company_id} AND id=${c.project_id}`).length) throw new ServiceError('INVALID_PROJECT');
  const rows = await sql.transaction([
    sql`INSERT INTO crm_leads(company_id,customer_id,source,status,owner_user_id,project_id,interest,lost_reason,created_by,stage_id) VALUES(${c.company_id},${c.customer_id},${c.source},${c.status},${ownerId},${c.project_id},${c.interest},${c.lost_reason},${actor.userId},(SELECT id FROM crm_pipeline_stages WHERE company_id=${c.company_id} AND active ORDER BY position LIMIT 1)) RETURNING *`,
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.lead_created',jsonb_build_object('customer_id',${c.customer_id},'owner_user_id',${ownerId},'status',${c.status})) RETURNING id`,
  ]);
  return rows[0][0];
}

export async function updateLead(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = updateLeadInput.parse(input);
  await access(sql, actor, c.company_id, 'leads.write', asOwner);
  if (c.owner_user_id) await ensureOwner(sql, c.company_id, c.owner_user_id);
  if (c.project_id && !(await sql`SELECT 1 FROM projects WHERE company_id=${c.company_id} AND id=${c.project_id}`).length) throw new ServiceError('INVALID_PROJECT');
  const rows = await sql`WITH previous AS(SELECT * FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.id} AND version=${c.version} FOR UPDATE), changed AS(UPDATE crm_leads SET status=COALESCE(${c.status ?? null},status),owner_user_id=COALESCE(${c.owner_user_id ?? null},owner_user_id),project_id=CASE WHEN ${c.project_id === undefined} THEN project_id ELSE ${c.project_id} END,interest=COALESCE(${c.interest ?? null},interest),lost_reason=COALESCE(${c.lost_reason ?? null},lost_reason),version=version+1,updated_at=now() WHERE company_id=${c.company_id} AND id IN(SELECT id FROM previous) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'crm.lead_updated',to_jsonb(previous),to_jsonb(changed) FROM previous JOIN changed USING(id)) SELECT * FROM changed`;
  if (!rows.length) throw new ServiceError('VERSION_CONFLICT', 409);
  return rows[0];
}

export async function addInteraction(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = interactionInput.parse(input);
  await access(sql, actor, c.company_id, 'leads.write', asOwner);
  await ensureCustomer(sql, c.company_id, c.customer_id);
  if (c.lead_id && !(await sql`SELECT 1 FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.lead_id} AND customer_id=${c.customer_id}`).length) throw new ServiceError('INVALID_LEAD');
  const rows = await sql.transaction([
    sql`INSERT INTO crm_interactions(company_id,customer_id,lead_id,kind,body,created_by) VALUES(${c.company_id},${c.customer_id},${c.lead_id},${c.kind},${c.body},${actor.userId}) RETURNING *`,
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.interaction_added',jsonb_build_object('customer_id',${c.customer_id},'kind',${c.kind})) RETURNING id`,
  ]);
  return rows[0][0];
}

export async function addFollowUp(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = followUpInput.parse(input);
  await access(sql, actor, c.company_id, 'leads.write', asOwner);
  await ensureCustomer(sql, c.company_id, c.customer_id);
  const assignedTo = c.assigned_to || actor.userId;
  await ensureOwner(sql, c.company_id, assignedTo);
  if (c.lead_id && !(await sql`SELECT 1 FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.lead_id} AND customer_id=${c.customer_id}`).length) throw new ServiceError('INVALID_LEAD');
  const rows = await sql.transaction([
    sql`INSERT INTO crm_follow_ups(company_id,customer_id,lead_id,due_at,title,assigned_to,created_by) VALUES(${c.company_id},${c.customer_id},${c.lead_id},${c.due_at},${c.title},${assignedTo},${actor.userId}) RETURNING *`,
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.follow_up_created',jsonb_build_object('customer_id',${c.customer_id},'due_at',${c.due_at})) RETURNING id`,
  ]);
  return rows[0][0];
}
