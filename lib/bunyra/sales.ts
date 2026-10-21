import { z } from 'zod';
import {hasPermission} from './permissions';
import {crmScope,requireLead} from './crm-scope';
import { access, type Actor, type Sql, ServiceError, uuid } from './service';

const stageInput = z.object({ company_id: uuid, id: uuid.optional(), name: z.string().trim().min(2).max(80), name_en: z.string().trim().max(80).default(''), active: z.boolean().default(true) });
const reorderInput = z.object({ company_id: uuid, ids: z.array(uuid).min(1) });
const teamInput = z.object({ company_id: uuid, id: uuid.optional(), name: z.string().trim().min(2).max(100), manager_user_id: z.string().min(1).max(200), version: z.number().int().positive().optional() });
const memberInput = z.object({ company_id: uuid, team_id: uuid, user_id: z.string().min(1).max(200) });
const transferInput = z.object({ company_id: uuid, lead_id: uuid, to_user_id: z.string().min(1).max(200), reason: z.string().trim().max(500).default('') });
const stageMoveInput = z.object({ company_id: uuid, lead_id: uuid, stage_id: uuid, version: z.number().int().positive(), reason: z.string().trim().min(3).max(500) });
const followUpInput = z.object({ company_id: uuid, id: uuid, status: z.enum(['done', 'cancelled']) });

function canManage(role: string, owner: boolean) { return owner || ['company_admin', 'sales_manager', 'sales_admin', 'operations'].includes(role); }
async function ensureMember(sql: Sql, companyId: string, userId: string) {
  if (!(await sql`SELECT 1 FROM memberships WHERE company_id=${companyId} AND user_id=${userId} AND active`).length) throw new ServiceError('INVALID_MEMBER', 400);
}

export async function salesOverview(sql: Sql, actor: Actor, companyId: string, asOwner = false) {
  const {ctx,ids,users,customerIds}=await crmScope(sql,actor,companyId,'leads.read',asOwner);
  const [stages, teams, leads, followUps, transfers, stageReport, repReport, sourceReport, agingReport] = await Promise.all([
    sql`SELECT id,name,name_en,position,active FROM crm_pipeline_stages WHERE company_id=${companyId} ORDER BY position`,
    sql`SELECT t.id,t.name,t.manager_user_id,t.active,t.version,COALESCE(json_agg(json_build_object('user_id',m.user_id,'email',u.email)) FILTER(WHERE m.user_id IS NOT NULL),'[]') AS members FROM crm_sales_teams t LEFT JOIN crm_sales_team_members m ON m.company_id=t.company_id AND m.team_id=t.id LEFT JOIN memberships u ON u.company_id=m.company_id AND u.user_id=m.user_id WHERE t.company_id=${companyId} AND (${users===null} OR t.manager_user_id=${actor.userId} OR m.user_id=${actor.userId}) GROUP BY t.id ORDER BY t.name`,
    sql`SELECT l.id,l.customer_id,c.full_name,l.owner_user_id,l.stage_id,l.status,l.source,l.version,l.updated_at,s.name,s.name_en FROM crm_leads l JOIN crm_customers c ON c.company_id=l.company_id AND c.id=l.customer_id LEFT JOIN crm_pipeline_stages s ON s.company_id=l.company_id AND s.id=l.stage_id WHERE l.company_id=${companyId} AND l.id=ANY(${ids}::uuid[]) ORDER BY l.updated_at DESC LIMIT 500`,
    sql`SELECT f.id,f.customer_id,c.full_name,f.lead_id,f.due_at,f.title,f.status,f.assigned_to FROM crm_follow_ups f JOIN crm_customers c ON c.company_id=f.company_id AND c.id=f.customer_id WHERE f.company_id=${companyId} AND f.customer_id=ANY(${customerIds}::uuid[]) AND (${users===null} OR f.assigned_to=ANY(${users||[]}::text[])) AND (f.lead_id IS NULL OR f.lead_id=ANY(${ids}::uuid[])) AND f.status='open' ORDER BY f.due_at ASC LIMIT 200`,
    sql`SELECT h.id,h.lead_id,h.from_user_id,h.to_user_id,h.reason,h.created_by,h.created_at,c.full_name FROM crm_lead_transfers h JOIN crm_leads l ON l.company_id=h.company_id AND l.id=h.lead_id JOIN crm_customers c ON c.company_id=l.company_id AND c.id=l.customer_id WHERE h.company_id=${companyId} AND h.lead_id=ANY(${ids}::uuid[]) ORDER BY h.created_at DESC LIMIT 100`,
    sql`SELECT s.id,s.name,s.name_en,s.position,COUNT(l.id)::int AS total,COUNT(l.id) FILTER(WHERE l.status='won')::int AS won,COUNT(l.id) FILTER(WHERE l.status='lost')::int AS lost,COUNT(l.id) FILTER(WHERE l.status NOT IN('won','lost'))::int AS open,COALESCE(ROUND(100.0*COUNT(l.id) FILTER(WHERE l.status='won')/NULLIF(COUNT(l.id),0),1),0) AS conversion_pct FROM crm_pipeline_stages s LEFT JOIN crm_leads l ON l.company_id=s.company_id AND l.stage_id=s.id AND l.id=ANY(${ids}::uuid[]) WHERE s.company_id=${companyId} GROUP BY s.id ORDER BY s.position`,
    sql`SELECT m.user_id,m.email,m.role,COALESCE(l.total,0)::int AS total,COALESCE(l.won,0)::int AS won,COALESCE(l.open,0)::int AS open,COALESCE(f.overdue,0)::int AS overdue FROM memberships m LEFT JOIN (SELECT owner_user_id,COUNT(*) AS total,COUNT(*) FILTER(WHERE status='won') AS won,COUNT(*) FILTER(WHERE status NOT IN('won','lost')) AS open FROM crm_leads WHERE company_id=${companyId} AND id=ANY(${ids}::uuid[]) GROUP BY owner_user_id) l ON l.owner_user_id=m.user_id LEFT JOIN (SELECT assigned_to,COUNT(*) AS overdue FROM crm_follow_ups WHERE company_id=${companyId} AND customer_id=ANY(${customerIds}::uuid[]) AND (${users===null} OR assigned_to=ANY(${users||[]}::text[])) AND status='open' AND due_at<now() GROUP BY assigned_to) f ON f.assigned_to=m.user_id WHERE m.company_id=${companyId} AND (${users===null} OR m.user_id=ANY(${users||[]}::text[])) AND m.active ORDER BY total DESC,m.email`,
    sql`SELECT source,COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='won')::int AS won,COALESCE(ROUND(100.0*COUNT(*) FILTER(WHERE status='won')/NULLIF(COUNT(*),0),1),0) AS conversion_pct FROM crm_leads WHERE company_id=${companyId} AND id=ANY(${ids}::uuid[]) GROUP BY source ORDER BY total DESC,source`,
    sql`SELECT bucket,COUNT(*)::int AS total FROM (SELECT CASE WHEN now()-created_at<interval '3 days' THEN '0-2 days' WHEN now()-created_at<interval '7 days' THEN '3-6 days' WHEN now()-created_at<interval '30 days' THEN '7-29 days' ELSE '30+ days' END AS bucket FROM crm_leads WHERE company_id=${companyId} AND id=ANY(${ids}::uuid[]) AND status NOT IN('won','lost')) x GROUP BY bucket ORDER BY CASE bucket WHEN '0-2 days' THEN 1 WHEN '3-6 days' THEN 2 WHEN '7-29 days' THEN 3 ELSE 4 END`,
  ]);
  return { ...ctx,members:repReport.map(m=>({user_id:m.user_id,email:m.email,role:m.role})), stages, teams, leads, followUps, transfers, reports: { stage: stageReport, representatives: repReport, sources: sourceReport, aging: agingReport }, can_assign_team_members:ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'members.manage'),can_manage_sales: canManage(ctx.role, ctx.owner) };
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
  if(ctx.role==='sales_manager'&&!ctx.owner){if(c.manager_user_id!==actor.userId)throw new ServiceError('FORBIDDEN',403);if(c.id&&!(await sql`SELECT id FROM crm_sales_teams WHERE company_id=${c.company_id} AND id=${c.id} AND manager_user_id=${actor.userId}`).length)throw new ServiceError('FORBIDDEN',403);}
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
  if (!(ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'members.manage'))) throw new ServiceError('FORBIDDEN', 403);
  if(ctx.role==='sales_manager'&&!ctx.owner&&!(await sql`SELECT id FROM crm_sales_teams WHERE company_id=${c.company_id} AND id=${c.team_id} AND manager_user_id=${actor.userId}`).length)throw new ServiceError('FORBIDDEN',403);
  await ensureMember(sql, c.company_id, c.user_id);
  if (!(await sql`SELECT 1 FROM crm_sales_teams WHERE company_id=${c.company_id} AND id=${c.team_id}`).length) throw new ServiceError('NOT_FOUND', 404);
  await sql`WITH assigned AS(INSERT INTO crm_sales_team_members(company_id,team_id,user_id) VALUES(${c.company_id},${c.team_id},${c.user_id}) ON CONFLICT DO NOTHING RETURNING user_id),logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.company_id}::uuid,${actor.userId}::text,${actor.email}::text,'crm.team_member_assigned',jsonb_build_object('team_id',${c.team_id}::uuid,'user_id',assigned.user_id) FROM assigned) SELECT user_id FROM assigned`;
  return { ok: true };
}

export async function transferLead(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = transferInput.parse(input); const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  if (!canManage(ctx.role, ctx.owner)) throw new ServiceError('FORBIDDEN', 403);
  const scope=await requireLead(sql,actor,c.company_id,c.lead_id,asOwner);if(scope.users&&!scope.users.includes(c.to_user_id))throw new ServiceError('FORBIDDEN',403);
  await ensureMember(sql, c.company_id, c.to_user_id);
  const rows=await sql`WITH previous AS MATERIALIZED(SELECT * FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.lead_id} AND owner_user_id=${scope.row.owner_user_id} AND version=${scope.row.version} FOR UPDATE),changed AS(UPDATE crm_leads SET owner_user_id=${c.to_user_id},version=version+1,updated_at=now() WHERE company_id=${c.company_id} AND id IN(SELECT id FROM previous) RETURNING *),transferred AS(INSERT INTO crm_lead_transfers(company_id,lead_id,from_user_id,to_user_id,reason,created_by) SELECT ${c.company_id}::uuid,previous.id,previous.owner_user_id,${c.to_user_id}::text,${c.reason}::text,${actor.userId}::text FROM previous JOIN changed USING(id)),logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id}::uuid,${actor.userId}::text,${actor.email}::text,'crm.lead_transferred',to_jsonb(previous),to_jsonb(changed)||jsonb_build_object('reason',${c.reason}::text) FROM previous JOIN changed USING(id)) SELECT * FROM changed`;
  if(!rows.length)throw new ServiceError('VERSION_CONFLICT',409);
  return rows[0];
}

export async function moveLeadStage(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = stageMoveInput.parse(input);
  const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  const scope=await requireLead(sql,actor,c.company_id,c.lead_id,asOwner);
  if(scope.row.stage_id===c.stage_id)throw new ServiceError('STAGE_UNCHANGED',409);
  if (!(await sql`SELECT 1 FROM crm_pipeline_stages WHERE company_id=${c.company_id} AND id=${c.stage_id} AND active`).length) throw new ServiceError('INVALID_STAGE', 400);
  const rows = await sql`WITH target AS MATERIALIZED(
    SELECT id FROM crm_pipeline_stages WHERE company_id=${c.company_id} AND id=${c.stage_id} AND active FOR SHARE
  ), previous AS MATERIALIZED(
    SELECT * FROM crm_leads WHERE company_id=${c.company_id} AND id=${c.lead_id} AND version=${c.version}
      AND owner_user_id=${scope.row.owner_user_id} AND project_id IS NOT DISTINCT FROM ${scope.row.project_id}::uuid
      AND (owner_user_id=${actor.userId} OR ${canManage(ctx.role,ctx.owner)}::boolean) AND EXISTS(SELECT 1 FROM target) FOR UPDATE
  ), changed AS(
    UPDATE crm_leads SET stage_id=${c.stage_id},version=version+1,updated_at=now()
    WHERE company_id=${c.company_id} AND id IN(SELECT id FROM previous) RETURNING *
  ), logged AS(
    INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data)
    SELECT ${c.company_id}::uuid,${actor.userId}::text,${actor.email}::text,'crm.lead_stage_changed',
      to_jsonb(previous),to_jsonb(changed)||jsonb_build_object('reason',${c.reason}::text)
    FROM previous JOIN changed USING(id)
  ) SELECT * FROM changed`;
  if (!rows.length) throw new ServiceError('VERSION_CONFLICT', 409);
  return rows[0];
}

export async function updateFollowUp(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = followUpInput.parse(input); const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  const scope=await crmScope(sql,actor,c.company_id,'leads.write',asOwner);
  const rows = await sql`UPDATE crm_follow_ups SET status=${c.status},completed_at=CASE WHEN ${c.status}='done' THEN now() ELSE null END WHERE company_id=${c.company_id} AND id=${c.id} AND customer_id=ANY(${scope.customerIds}::uuid[]) AND (${scope.users===null} OR assigned_to=ANY(${scope.users||[]}::text[])) AND (lead_id IS NULL OR lead_id=ANY(${scope.ids}::uuid[])) RETURNING *`;
  if (!rows.length) throw new ServiceError('FORBIDDEN', 403);
  await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'crm.follow_up_updated',${JSON.stringify(rows[0])}::jsonb)`;
  return rows[0];
}
