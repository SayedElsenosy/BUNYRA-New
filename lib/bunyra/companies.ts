import type { NeonQueryFunction } from '@neondatabase/serverless';
import { z } from 'zod';
import { bindTenant } from './tenant';
import { ServiceError, owner, newToken } from './service';

type Sql = NeonQueryFunction<false, false>;
type Actor = { userId: string; email: string };
export type ObjectRemover = { remove(key: string): Promise<void> };

export const RETENTION_DAYS = 30;

const email = z.string().trim().toLowerCase().email().max(254);
const optionalEmail = z.union([email, z.literal('')]).default('');
export const companySchema = z.object({
  name: z.string().trim().min(2).max(160),
  name_en: z.string().trim().max(160).default(''),
  email: optionalEmail,
  phone: z.string().trim().max(40).default(''),
  address: z.string().trim().max(500).default(''),
});
const createSchema = companySchema.extend({ owner_email: optionalEmail });
const requestSchema = z.object({
  company_name: z.string().trim().min(2).max(160),
  company_name_en: z.string().trim().max(160).default(''),
  contact_name: z.string().trim().min(2).max(120),
  email,
  phone: z.string().trim().max(40).default(''),
  message: z.string().trim().max(2000).default(''),
  website: z.string().max(0, 'BOT').default(''),
});
const reviewSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).default(''),
});
const lifecycleSchema = z.object({ id: z.string().uuid(), version: z.number().int().positive(), confirm: z.string().default('') });

async function requireOwner(sql: Sql, actor: Actor) {
  bindTenant(sql, null);
  if (!(await owner(sql, actor))) throw new ServiceError('FORBIDDEN', 403);
}

function ownerInvite(sql: Sql, actor: Actor, companyId: string, to: string, hash: string, guard: string) {
  const id = crypto.randomUUID();
  return [
    sql`INSERT INTO invitations(id,company_id,email,role,token_hash,created_by) SELECT ${id},${companyId},${to},'company_admin',${hash},${actor.userId} WHERE EXISTS(SELECT 1 FROM companies WHERE id=${guard})`,
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${companyId},${actor.userId},${actor.email},'invitation.created',${JSON.stringify({ id, email: to, role: 'company_admin', owner: true })}::jsonb WHERE EXISTS(SELECT 1 FROM companies WHERE id=${guard})`,
  ];
}

export async function createCompany(sql: Sql, actor: Actor, input: unknown) {
  await requireOwner(sql, actor);
  const c = createSchema.parse(input);
  const id = crypto.randomUUID();
  const secret = c.owner_email ? await newToken() : null;
  const res = await sql.transaction([
    sql`WITH created AS(INSERT INTO companies(id,name,name_en,email,phone,address) VALUES(${id},${c.name},${c.name_en},${c.email},${c.phone},${c.address}) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT id,${actor.userId},${actor.email},'company.created',to_jsonb(created) FROM created) SELECT * FROM created`,
    sql`INSERT INTO company_settings(company_id) VALUES(${id})`,
    ...(secret ? ownerInvite(sql, actor, id, c.owner_email, secret.hash, id) : []),
  ]);
  return { company: res[0][0], invite: secret ? { email: c.owner_email, token: secret.token } : null };
}

export async function submitCompanyRequest(sql: Sql, input: unknown) {
  const r = requestSchema.parse(input);
  const recent = await sql`SELECT count(*)::int AS n FROM company_requests WHERE created_at>now()-interval '1 hour'`;
  if (recent[0].n >= 50) throw new ServiceError('RATE_LIMITED', 429);
  const rows = await sql`INSERT INTO company_requests(company_name,company_name_en,contact_name,email,phone,message) VALUES(${r.company_name},${r.company_name_en},${r.contact_name},${r.email},${r.phone},${r.message}) ON CONFLICT (email) WHERE status='pending' DO NOTHING RETURNING id`;
  if (!rows.length) throw new ServiceError('REQUEST_PENDING', 409);
  return { id: rows[0].id as string };
}

export async function listCompanyRequests(sql: Sql, actor: Actor) {
  await requireOwner(sql, actor);
  return sql`SELECT * FROM company_requests ORDER BY status='pending' DESC, created_at DESC LIMIT 200`;
}

export async function reviewCompanyRequest(sql: Sql, actor: Actor, input: unknown) {
  await requireOwner(sql, actor);
  const r = reviewSchema.parse(input);
  if (r.decision === 'reject') {
    const rows = await sql`WITH changed AS(UPDATE company_requests SET status='rejected',review_note=${r.note},reviewed_by=${actor.userId},reviewed_at=now(),version=version+1 WHERE id=${r.id} AND version=${r.version} AND status='pending' RETURNING *), logged AS(INSERT INTO audit_logs(actor_id,actor_email,action,after_data) SELECT ${actor.userId},${actor.email},'company_request.rejected',to_jsonb(changed) FROM changed) SELECT * FROM changed`;
    if (!rows.length) throw new ServiceError('VERSION_CONFLICT', 409);
    return { request: rows[0], company: null, invite: null };
  }
  const cid = crypto.randomUUID();
  const secret = await newToken();
  const pending = await sql`SELECT email FROM company_requests WHERE id=${r.id} AND version=${r.version} AND status='pending'`;
  if (!pending.length) throw new ServiceError('VERSION_CONFLICT', 409);
  const to = pending[0].email as string;
  const res = await sql.transaction([
    sql`WITH created AS(INSERT INTO companies(id,name,name_en,email,phone) SELECT ${cid},company_name,company_name_en,email,phone FROM company_requests WHERE id=${r.id} AND version=${r.version} AND status='pending' FOR UPDATE RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT id,${actor.userId},${actor.email},'company.created',to_jsonb(created)||jsonb_build_object('request_id',${r.id}::uuid) FROM created) SELECT * FROM created`,
    sql`UPDATE company_requests SET status='approved',review_note=${r.note},reviewed_by=${actor.userId},reviewed_at=now(),created_company_id=${cid},version=version+1 WHERE id=${r.id} AND EXISTS(SELECT 1 FROM companies WHERE id=${cid}) RETURNING *`,
    sql`INSERT INTO company_settings(company_id) SELECT ${cid} WHERE EXISTS(SELECT 1 FROM companies WHERE id=${cid})`,
    ...ownerInvite(sql, actor, cid, to, secret.hash, cid),
  ]);
  if (!res[0].length) throw new ServiceError('VERSION_CONFLICT', 409);
  return { request: res[1][0], company: res[0][0], invite: { email: to, token: secret.token } };
}

const IMPACT = ['memberships', 'invitations', 'custom_roles', 'organization_nodes', 'projects', 'inventory_units', 'unit_status_history', 'inventory_imports', 'project_plan_files', 'plan_layouts', 'audit_logs'] as const;
// Child-first order so foreign keys never block the purge. audit_logs and the company row are retained.
const PURGE = ['plan_unit_shapes', 'unit_status_history', 'plan_layouts', 'inventory_units', 'inventory_imports', 'project_plan_files', 'project_setups', 'member_placements', 'member_permissions', 'organization_nodes', 'invitations', 'memberships', 'custom_roles', 'projects', 'company_settings'] as const;

export async function deletionImpact(sql: Sql, actor: Actor, id: string) {
  await requireOwner(sql, actor);
  const companyId = z.string().uuid().parse(id);
  const found = await sql`SELECT id,name,status,version,deleted_at,purge_after,purged_at FROM companies WHERE id=${companyId}`;
  if (!found.length) throw new ServiceError('NOT_FOUND', 404);
  const counts = await sql.query(`SELECT ${IMPACT.map(t => `(SELECT count(*)::int FROM ${t} WHERE company_id=$1) AS ${t}`).join(',')}`, [companyId]);
  return { company: found[0], counts: counts[0] as Record<(typeof IMPACT)[number], number>, retention_days: RETENTION_DAYS };
}

async function loadForLifecycle(sql: Sql, actor: Actor, input: unknown) {
  await requireOwner(sql, actor);
  const c = lifecycleSchema.parse(input);
  const found = await sql`SELECT * FROM companies WHERE id=${c.id}`;
  if (!found.length) throw new ServiceError('NOT_FOUND', 404);
  return { c, company: found[0] };
}

export async function scheduleCompanyDeletion(sql: Sql, actor: Actor, input: unknown) {
  const { c, company } = await loadForLifecycle(sql, actor, input);
  if (company.status === 'deleted') throw new ServiceError('ALREADY_DELETED', 409);
  if (c.confirm !== company.name) throw new ServiceError('CONFIRMATION_MISMATCH');
  const { counts } = await deletionImpact(sql, actor, c.id);
  const res = await sql.transaction([
    sql`UPDATE companies SET previous_status=status,status='deleted',deleted_at=now(),deleted_by=${actor.userId},purge_after=now()+make_interval(days=>${RETENTION_DAYS}),version=version+1,updated_at=now() WHERE id=${c.id} AND version=${c.version} AND status<>'deleted' RETURNING *`,
    sql`UPDATE invitations SET status='revoked' WHERE company_id=${c.id} AND status='pending' AND EXISTS(SELECT 1 FROM companies WHERE id=${c.id} AND status='deleted' AND version=${c.version + 1}) RETURNING id`,
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT id,${actor.userId},${actor.email},'company.deletion_scheduled',${JSON.stringify({ status: company.status })}::jsonb,jsonb_build_object('purge_after',purge_after,'impact',${JSON.stringify(counts)}::jsonb) FROM companies WHERE id=${c.id} AND status='deleted' AND version=${c.version + 1}`,
  ]);
  if (!res[0].length) throw new ServiceError('VERSION_CONFLICT', 409);
  return { company: res[0][0], revoked_invitations: res[1].length };
}

export async function restoreCompany(sql: Sql, actor: Actor, input: unknown) {
  const { c } = await loadForLifecycle(sql, actor, input);
  const rows = await sql`WITH changed AS(UPDATE companies SET status=previous_status,previous_status=NULL,deleted_at=NULL,deleted_by=NULL,purge_after=NULL,version=version+1,updated_at=now() WHERE id=${c.id} AND version=${c.version} AND status='deleted' AND purged_at IS NULL RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT id,${actor.userId},${actor.email},'company.restored',jsonb_build_object('status',status) FROM changed) SELECT * FROM changed`;
  if (!rows.length) throw new ServiceError('VERSION_CONFLICT', 409);
  return { company: rows[0] };
}

export async function purgeCompany(sql: Sql, actor: Actor, input: unknown, storage?: ObjectRemover) {
  const { c, company } = await loadForLifecycle(sql, actor, input);
  if (company.status !== 'deleted' || company.purged_at) throw new ServiceError('NOT_SCHEDULED', 409);
  if (new Date(company.purge_after) > new Date()) throw new ServiceError('RETENTION_ACTIVE', 409);
  if (c.confirm !== company.name) throw new ServiceError('CONFIRMATION_MISMATCH');
  const keys = (await sql`SELECT object_key FROM project_plan_files WHERE company_id=${c.id} AND object_key IS NOT NULL`).map(r => r.object_key as string);
  if (keys.length && !storage) throw new ServiceError('STORAGE_NOT_CONFIGURED', 503);
  const { counts } = await deletionImpact(sql, actor, c.id);
  const purged = `EXISTS(SELECT 1 FROM companies WHERE id=$1 AND purged_at IS NOT NULL AND version=${c.version + 1})`;
  const res = await sql.transaction([
    sql`UPDATE companies SET purged_at=now(),email='',phone='',address='',version=version+1,updated_at=now() WHERE id=${c.id} AND version=${c.version} AND status='deleted' AND purged_at IS NULL AND purge_after<=now() RETURNING id`,
    ...PURGE.map(t => sql.query(`DELETE FROM ${t} WHERE company_id=$1 AND ${purged}`, [c.id])),
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.id},${actor.userId},${actor.email},'company.purged',${JSON.stringify({ deleted: counts, files: keys.length })}::jsonb WHERE EXISTS(SELECT 1 FROM companies WHERE id=${c.id} AND purged_at IS NOT NULL AND version=${c.version + 1})`,
  ]);
  if (!res[0].length) throw new ServiceError('VERSION_CONFLICT', 409);
  const failed: string[] = [];
  for (const key of keys) {
    try { await storage!.remove(key); } catch { failed.push(key); }
  }
  if (failed.length) await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.id},${actor.userId},${actor.email},'company.purge_storage_failed',${JSON.stringify({ keys: failed })}::jsonb)`;
  return { purged: counts, files_removed: keys.length - failed.length, files_failed: failed.length };
}
