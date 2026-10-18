import type { NeonQueryFunction } from '@neondatabase/serverless';
import { z } from 'zod';
import { bindTenant } from './tenant';
import { ServiceError, owner } from './service';

type Sql = NeonQueryFunction<false, false>;
type Actor = { userId: string; email: string };

const NOISE = ['company.view', 'platform_owner.company_access'];

async function requireOwner(sql: Sql, actor: Actor) {
  bindTenant(sql, null);
  if (!(await owner(sql, actor))) throw new ServiceError('FORBIDDEN', 403);
}

export async function companyOverview(sql: Sql, actor: Actor, id: string) {
  await requireOwner(sql, actor);
  const companyId = z.string().uuid().parse(id);
  const found = await sql`SELECT * FROM companies WHERE id=${companyId}`;
  if (!found.length) throw new ServiceError('NOT_FOUND', 404);
  const [, projects, members, branches, settings, units, invites, activity] = await sql.transaction([
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action) VALUES(${companyId},${actor.userId},${actor.email},'company.view')`,
    sql`SELECT p.id,p.name,p.created_at,(SELECT count(*)::int FROM inventory_units u WHERE u.company_id=p.company_id AND u.project_id=p.id) AS units_count FROM projects p WHERE p.company_id=${companyId} ORDER BY p.name`,
    sql`SELECT user_id,email,role,active FROM memberships WHERE company_id=${companyId} ORDER BY active DESC,email`,
    sql`SELECT id,code,name,name_en,active FROM organization_nodes WHERE company_id=${companyId} AND kind='branch' ORDER BY name`,
    sql`SELECT currency,time_zone,locale FROM company_settings WHERE company_id=${companyId}`,
    sql`SELECT status,count(*)::int AS n FROM inventory_units WHERE company_id=${companyId} GROUP BY status ORDER BY status`,
    sql`SELECT count(*)::int AS n FROM invitations WHERE company_id=${companyId} AND status='pending' AND expires_at>now()`,
    sql`SELECT id::text,actor_email,action,created_at FROM audit_logs WHERE company_id=${companyId} AND action<>ALL(${NOISE}) ORDER BY id DESC LIMIT 20`,
  ]);
  return {
    company: found[0],
    projects,
    members,
    branches,
    settings: settings[0] ?? null,
    summary: {
      active_members: members.filter(m => m.active).length,
      inactive_members: members.filter(m => !m.active).length,
      pending_invitations: invites[0].n as number,
      units: Object.fromEntries(units.map(u => [u.status, u.n])) as Record<string, number>,
    },
    activity,
  };
}

export async function platformAudit(sql: Sql, actor: Actor, filter: { company?: string; changesOnly?: boolean } = {}) {
  await requireOwner(sql, actor);
  const company = filter.company ? z.string().uuid().parse(filter.company) : null;
  const skip = filter.changesOnly ? NOISE : [];
  return sql`SELECT a.id::text,a.company_id,a.actor_email,a.action,a.created_at,c.name AS company_name
    FROM audit_logs a LEFT JOIN companies c ON c.id=a.company_id
    WHERE (${company}::uuid IS NULL OR a.company_id=${company}::uuid) AND a.action<>ALL(${skip}::text[])
    ORDER BY a.id DESC LIMIT 100`;
}
