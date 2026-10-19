import { z } from 'zod';
import { access, type Actor, type Sql, ServiceError, uuid } from './service';

const stageInput = z.object({ company_id: uuid, id: uuid.optional(), name: z.string().trim().min(2).max(80), name_en: z.string().trim().max(80).default(''), active: z.boolean().default(true) });
const reorderInput = z.object({ company_id: uuid, ids: z.array(uuid).min(1) });
const teamInput = z.object({ company_id: uuid, id: uuid.optional(), name: z.string().trim().min(2).max(100), manager_user_id: z.string().min(1).max(200), version: z.number().int().positive().optional() });
const memberInput = z.object({ company_id: uuid, team_id: uuid, user_id: z.string().min(1).max(200) });
const transferInput = z.object({ company_id: uuid, lead_id: uuid, to_user_id: z.string().min(1).max(200), reason: z.string().trim().max(500).default('') });
const stageMoveInput = z.object({ company_id: uuid, lead_id: uuid, stage_id: uuid, version: z.number().int().positive() });
const followUpInput = z.object({ company_id: uuid, id: uuid, status: z.enum(['done', 'cancelled']) });

function canManage(role: string, owner: boolean) { return owner || ['company_admin', 'sales_manager', 'sales_admin', 'operations'].includes(role); }
async function ensureMember(sql: Sql, companyId: string, userId: string) {
  if (!(await sql`SELECT 1 FROM memberships WHERE company_id=${companyId} AND user_id=${userId} AND active`).length) throw new ServiceError('INVALID_MEMBER', 400);
}

export async function salesOverview(sql: Sql, actor: Actor, companyId: string, asOwner = false) {
  const ctx = await access(sql, actor, companyId, 'leads.read', asOwner);
  const [stages, teams, leads, followUps, transfers] = await Promise.all([
    sql`SELECT id,name,name_en,position,active FROM crm_pipeline_stages WHERE company_id=${companyId} ORDER BY position`,
    sql`SELECT t.id,t.name,t.manager_user_id,t.active,t.version,COALESCE(json_agg(json_build_object('user_id',m.user_id,'email',u.email)) FILTER(WHERE m.user_id IS NOT NULL),'[]') AS members FROM crm_sales_teams t LEFT JOIN crm_sales_team_members m ON m.company_id=t.company_id AND m.team_id=t.id LEFT JOIN memberships u ON u.company_id=m.company_id AND u.user_id=m.user_id WHERE t.company_id=${companyId} GROUP BY t.id ORDER BY t.name`,
    sql`SELECT l.id,l.customer_id,c.full_name,l.owner_user_id,l.stage_id,l.status,l.source,l.version,l.updated_at,s.name,s.name_en FROM crm_leads l JOIN crm_customers c ON c.company_id=l.company_id AND c.id=l.customer_id LEFT JOIN crm_pipeline_stages s ON s.company_id=l.company_id AND s.id=l.stage_id WHERE l.company_id=${companyId} ORDER BY l.updated_at DESC LIMIT 500`,
    sql`SELECT f.id,f.customer_id,c.full_name,f.lead_id,f.due_at,f.title,f.status,f.assigned_to FROM crm_follow_ups f JOIN crm_customers c ON c.company_id=f.company_id AND c.id=f.customer_id WHERE f.company_id=${companyId} AND f.status='open' ORDER BY f.due_at ASC LIMIT 200`,
    sql`SELECT h.id,h.lead_id,h.from_user_id,h.to_user_id,h.reason,h.created_by,h.created_at,c.full_name FROM crm_lead_transfers h JOIN crm_leads l ON l.company_id=h.company_id AND l.id=h.lead_id JOIN crm_customers c ON c.company_id=l.company_id AND c.id=l.customer_id WHERE h.company_id=${companyId} ORDER BY h.created_at DESC LIMIT 100`,
  ]);
  return { ...ctx, stages, teams, leads, followUps, transfers, can_manage_sales: canManage(ctx.role, ctx.owner) };
}

export async function saveStage(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = stageInput.parse(input); const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  if (!canManage(ctx.role, ctx.owner)) throw new ServiceError('FORBIDDEN', 403);
  if (c.id) {
    const rows = await sql`UPDATE crm_pipeline_stages SET name=${c.name},name_en=${c.name_en},active=${c.active} WHERE company_id=${c.company_id} AND id=${c.id} RETURNING *`;
    if (!rows.length) throw new ServiceError('NOT_FOUND', 404);
    await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.pipeline_stage_updated',${JSON.stringify(rows[0])}::jsonb)`;
    return rows[0];
  }
  const position = Number((await sql`SELECT COALESCE(max(position),-1)+1 AS next FROM crm_pipeline_stages WHERE company_id=${c.company_id}`)[0].next);
  const rows = await sql`INSERT INTO crm_pipeline_stages(company_id,name,name_en,position,active) VALUES(${c.company_id},${c.name},${c.name_en},${position},${c.active}) RETURNING *`;
  await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.pipeline_stage_created',${JSON.stringify(rows[0])}::jsonb)`;
  return rows[0];
}

export async function reorderStages(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = reorderInput.parse(input); const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  if (!canManage(ctx.role, ctx.owner)) throw new ServiceError('FORBIDDEN', 403);
  const existing = await sql`SELECT id FROM crm_pipeline_stages WHERE company_id=${c.company_id}`;
  if (existing.length !== c.ids.length || new Set(c.ids).size !== c.ids.length || c.ids.some(id => !existing.some(row => row.id === id))) throw new ServiceError('INVALID_STAGE_ORDER');
  const statements = [sql`UPDATE crm_pipeline_stages SET position=position+10000 WHERE company_id=${c.company_id}`];
  c.ids.forEach((id, index) => statements.push(sql`UPDATE crm_pipeline_stages SET position=${index} WHERE company_id=${c.company_id} AND id=${id}`));
  statements.push(sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.pipeline_reordered',jsonb_build_object('stage_ids',${JSON.stringify(c.ids)}::jsonb))`);
  await sql.transaction(statements); return { ok: true };
}

export async function saveSalesTeam(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = teamInput.parse(input); const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  if (!canManage(ctx.role, ctx.owner)) throw new ServiceError('FORBIDDEN', 403);
  await ensureMember(sql, c.company_id, c.manager_user_id);
  if (c.id) {
    const rows = await sql`UPDATE crm_sales_teams SET name=${c.name},manager_user_id=${c.manager_user_id},version=version+1,updated_at=now() WHERE company_id=${c.company_id} AND id=${c.id} AND version=${c.version} RETURNING *`;
    if (!rows.length) throw new ServiceError('VERSION_CONFLICT', 409); return rows[0];
  }
  const rows = await sql`INSERT INTO crm_sales_teams(company_id,name,manager_user_id) VALUES(${c.company_id},${c.name},${c.manager_user_id}) RETURNING *`;
  await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.sales_team_created',${JSON.stringify(rows[0])}::jsonb)`;
  return rows[0];
}

export async function addTeamMember(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = memberInput.parse(input); const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  if (!canManage(ctx.role, ctx.owner)) throw new ServiceError('FORBIDDEN', 403);
  await ensureMember(sql, c.company_id, c.user_id);
  if (!(await sql`SELECT 1 FROM crm_sales_teams WHERE company_id=${c.company_id} AND id=${c.team_id}`).length) throw new ServiceError('NOT_FOUND', 404);
  await sql`INSERT INTO crm_sales_team_members(company_id,team_id,user_id) VALUES(${c.company_id},${c.team_id},${c.user_id}) ON CONFLICT DO NOTHING`;
  return { ok: true };
}

export async function transferLead(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = transferInput.parse(input); const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  if (!canManage(ctx.role, ctx.owner)) throw new ServiceError('FORBIDDEN', 403);
  await ensureMember(sql, c.company_id, c.to_user_id);
  const rows = await sql.transaction([
    sql`SELECT owner_user_id FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.lead_id} FOR UPDATE`,
    sql`UPDATE crm_leads SET owner_user_id=${c.to_user_id},version=version+1,updated_at=now() WHERE company_id=${c.company_id} AND id=${c.lead_id} RETURNING *`,
  ]);
  if (!rows[1].length) throw new ServiceError('NOT_FOUND', 404);
  await sql.transaction([
    sql`INSERT INTO crm_lead_transfers(company_id,lead_id,from_user_id,to_user_id,reason,created_by) VALUES(${c.company_id},${c.lead_id},${rows[0][0]?.owner_user_id || null},${c.to_user_id},${c.reason},${actor.userId})`,
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.lead_transferred',jsonb_build_object('lead_id',${c.lead_id},'to_user_id',${c.to_user_id},'reason',${c.reason}))`,
  ]);
  return rows[1][0];
}

export async function moveLeadStage(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = stageMoveInput.parse(input);
  const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  if (!(await sql`SELECT 1 FROM crm_pipeline_stages WHERE company_id=${c.company_id} AND id=${c.stage_id} AND active`).length) throw new ServiceError('INVALID_STAGE', 400);
  const rows = await sql`UPDATE crm_leads SET stage_id=${c.stage_id},version=version+1,updated_at=now() WHERE company_id=${c.company_id} AND id=${c.lead_id} AND version=${c.version} AND (owner_user_id=${actor.userId} OR ${canManage(ctx.role, ctx.owner)}) RETURNING *`;
  if (!rows.length) throw new ServiceError('VERSION_CONFLICT', 409);
  await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.lead_stage_changed',jsonb_build_object('lead_id',${c.lead_id},'stage_id',${c.stage_id}))`;
  return rows[0];
}

export async function updateFollowUp(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = followUpInput.parse(input); const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  const rows = await sql`UPDATE crm_follow_ups SET status=${c.status},completed_at=CASE WHEN ${c.status}='done' THEN now() ELSE null END WHERE company_id=${c.company_id} AND id=${c.id} AND (assigned_to=${actor.userId} OR ${canManage(ctx.role, ctx.owner)}) RETURNING *`;
  if (!rows.length) throw new ServiceError('FORBIDDEN', 403);
  await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.follow_up_updated',${JSON.stringify(rows[0])}::jsonb)`;
  return rows[0];
}
