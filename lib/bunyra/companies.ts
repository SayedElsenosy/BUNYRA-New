import type { NeonQueryFunction } from '@neondatabase/serverless';
import { z } from 'zod';
import { bindTenant } from './tenant';
import { ServiceError, owner } from './service';
import { accountFields } from './accounts';
import { hashPassword } from './passwords';

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
const createSchema = companySchema.extend({ account_limit:z.number().int().min(0).max(10000).default(5),admin:accountFields.optional() });
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

export async function createCompany(sql: Sql, actor: Actor, input: unknown) {
  await requireOwner(sql, actor);
  const c = createSchema.parse(input);
  const id = crypto.randomUUID();
  const adminId=crypto.randomUUID();const passwordHash=c.admin?await hashPassword(c.admin.password):null;
  const res = await sql.transaction([
    sql`WITH created AS(INSERT INTO companies(id,name,name_en,email,phone,address,account_limit) VALUES(${id},${c.name},${c.name_en},${c.email},${c.phone},${c.address},${c.account_limit}) RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT id,${actor.userId},${actor.email},'company.created',to_jsonb(created) FROM created) SELECT * FROM created`,
    sql`INSERT INTO company_settings(company_id) VALUES(${id})`,
    ...(c.admin?[
      sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${id},${adminId},${c.admin.email||c.admin.username},'company_admin')`,
      sql`INSERT INTO app_accounts(user_id,company_id,username,display_name,email,password_hash,created_by) VALUES(${adminId},${id},${c.admin.username},${c.admin.display_name},${c.admin.email},${passwordHash!},${actor.userId})`,
      sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${id},${actor.userId},${actor.email},'account.created',${JSON.stringify({user_id:adminId,username:c.admin.username,role:'company_admin'})}::jsonb)`
    ]:[]),
  ]);
  return { company: res[0][0],invite:null,admin:c.admin?{user_id:adminId,username:c.admin.username}:null };
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
  const pending = await sql`SELECT email FROM company_requests WHERE id=${r.id} AND version=${r.version} AND status='pending'`;
  if (!pending.length) throw new ServiceError('VERSION_CONFLICT', 409);
  const res = await sql.transaction([
    sql`WITH created AS(INSERT INTO companies(id,name,name_en,email,phone) SELECT ${cid},company_name,company_name_en,email,phone FROM company_requests WHERE id=${r.id} AND version=${r.version} AND status='pending' FOR UPDATE RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT id,${actor.userId},${actor.email},'company.created',to_jsonb(created)||jsonb_build_object('request_id',${r.id}::uuid) FROM created) SELECT * FROM created`,
    sql`UPDATE company_requests SET status='approved',review_note=${r.note},reviewed_by=${actor.userId},reviewed_at=now(),created_company_id=${cid},version=version+1 WHERE id=${r.id} AND EXISTS(SELECT 1 FROM companies WHERE id=${cid}) RETURNING *`,
    sql`INSERT INTO company_settings(company_id) SELECT ${cid} WHERE EXISTS(SELECT 1 FROM companies WHERE id=${cid})`,
  ]);
  if (!res[0].length) throw new ServiceError('VERSION_CONFLICT', 409);
  return { request: res[1][0], company: res[0][0], invite:null };
}

const IMPACT = ['commission_ledger','unit_lineage','workspace_alert_reads','crm_lead_routing_settings','crm_customers','crm_leads','buyer_requests','sales_offers','bookings','contracts','contract_installments','collections','financial_adjustments','booking_documents','customer_notifications','crm_sales_teams','plan_layout_revisions','price_books','memberships', 'invitations', 'custom_roles', 'organization_nodes', 'projects', 'inventory_units', 'unit_status_history', 'inventory_imports', 'project_plan_files', 'plan_layouts', 'audit_logs'] as const;
// Child-first order so foreign keys never block the purge. audit_logs and the company row are retained.
const PURGE = ['workspace_alert_reads','crm_lead_routing_settings','commission_ledger','unit_lineage','customer_notifications','financial_adjustments','booking_documents','collections','contract_installments','contracts','bookings','sales_offers','buyer_requests','crm_lead_transfers','crm_interactions','crm_follow_ups','crm_leads','crm_sales_team_members','crm_sales_teams','crm_pipeline_stages','crm_customers','price_book_entry_plans','price_book_entries','price_book_plans','project_pricing','price_books','plan_unit_shapes', 'unit_status_history','plan_layout_revisions', 'plan_layouts', 'inventory_units', 'inventory_imports', 'project_plan_files', 'project_setups', 'member_placements', 'member_permissions', 'organization_nodes', 'invitations', 'app_accounts','memberships', 'custom_roles', 'projects', 'company_settings'] as const;

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
  const keys = (await sql`SELECT object_key FROM project_plan_files WHERE company_id=${c.id} AND object_key IS NOT NULL UNION SELECT object_key FROM booking_documents WHERE company_id=${c.id} UNION SELECT object_key FROM sales_offers WHERE company_id=${c.id}`).map(r => r.object_key as string);
  if (keys.length && !storage) throw new ServiceError('STORAGE_NOT_CONFIGURED', 503);
  const { counts } = await deletionImpact(sql, actor, c.id);
  const purged = `EXISTS(SELECT 1 FROM companies WHERE id=$1 AND purged_at IS NOT NULL AND version=${c.version + 1})`;
  const res = await sql.transaction([
    sql`UPDATE companies SET purged_at=now(),email='',phone='',address='',version=version+1,updated_at=now() WHERE id=${c.id} AND version=${c.version} AND status='deleted' AND purged_at IS NULL AND purge_after<=now() RETURNING id`,
    sql`INSERT INTO storage_cleanup_jobs(company_id,object_key) SELECT company_id,object_key FROM project_plan_files WHERE company_id=${c.id} AND object_key IS NOT NULL AND EXISTS(SELECT 1 FROM companies WHERE id=${c.id} AND purged_at IS NOT NULL AND version=${c.version + 1}) ON CONFLICT(company_id,object_key) DO NOTHING`,
    sql`INSERT INTO storage_cleanup_jobs(company_id,object_key) SELECT company_id,object_key FROM booking_documents WHERE company_id=${c.id} AND EXISTS(SELECT 1 FROM companies WHERE id=${c.id} AND purged_at IS NOT NULL AND version=${c.version+1}) ON CONFLICT(company_id,object_key) DO NOTHING`,
    sql`INSERT INTO storage_cleanup_jobs(company_id,object_key) SELECT company_id,object_key FROM sales_offers WHERE company_id=${c.id} AND EXISTS(SELECT 1 FROM companies WHERE id=${c.id} AND purged_at IS NOT NULL AND version=${c.version+1}) ON CONFLICT(company_id,object_key) DO NOTHING`,
    ...PURGE.map(t => sql.query(`DELETE FROM ${t} WHERE company_id=$1 AND ${purged}`, [c.id])),
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.id},${actor.userId},${actor.email},'company.purged',${JSON.stringify({ deleted: counts, files: keys.length })}::jsonb WHERE EXISTS(SELECT 1 FROM companies WHERE id=${c.id} AND purged_at IS NOT NULL AND version=${c.version + 1})`,
  ]);
  if (!res[0].length) throw new ServiceError('VERSION_CONFLICT', 409);
  const cleanup = await retryCompanyStorage(sql, actor, {...c, version: c.version + 1}, storage);
  return { purged: counts, ...cleanup };
}

// The outbox survives removal of project_plan_files. S3 DELETE is idempotent;
// a crash between DELETE and acknowledgement safely repeats the same key.
export async function retryCompanyStorage(sql: Sql, actor: Actor, input: unknown, storage?: ObjectRemover) {
  const { c, company } = await loadForLifecycle(sql, actor, input);
  if (!company.purged_at) throw new ServiceError('NOT_SCHEDULED', 409);
  if (c.confirm !== company.name) throw new ServiceError('CONFIRMATION_MISMATCH');
  if (c.version !== company.version) throw new ServiceError('VERSION_CONFLICT', 409);
  const jobs = await sql`SELECT id,object_key FROM storage_cleanup_jobs WHERE company_id=${c.id} AND completed_at IS NULL ORDER BY id LIMIT 5`;
  if (jobs.length && !storage) throw new ServiceError('STORAGE_NOT_CONFIGURED', 503);
  let removed = 0;
  for (const job of jobs) {
    await sql`UPDATE storage_cleanup_jobs SET attempts=attempts+1 WHERE id=${job.id} AND completed_at IS NULL`;
    try { await storage!.remove(job.object_key as string); }
    catch { continue; }
    await sql`UPDATE storage_cleanup_jobs SET completed_at=now() WHERE id=${job.id} AND completed_at IS NULL`;
    removed++;
  }
  const pending = (await sql`SELECT count(*)::int n FROM storage_cleanup_jobs WHERE company_id=${c.id} AND completed_at IS NULL`)[0].n as number;
  await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.id},${actor.userId},${actor.email},'company.storage_cleanup',${JSON.stringify({removed,pending})}::jsonb)`;
  return { files_removed: removed, files_failed: pending };
}
