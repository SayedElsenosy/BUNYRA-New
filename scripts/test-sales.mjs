import assert from 'node:assert/strict';
import { tenantSql } from '../.sites-runtime/tests/tenant.mjs';
import * as crm from '../.sites-runtime/tests/crm.mjs';
import * as sales from '../.sites-runtime/tests/sales.mjs';

export async function runSalesTests(sql) {
  const checks = [];
  const check = async (name, fn) => { await fn(); checks.push({ name, passed: true }); };
  const a = crypto.randomUUID(), project = crypto.randomUUID(), tag = a.slice(0, 8);
  const admin = { userId: `sales-admin-${tag}`, email: `sales-admin-${tag}@example.com` };
  const manager = { userId: `sales-manager-${tag}`, email: `sales-manager-${tag}@example.com` };
  const rep = { userId: `sales-rep-${tag}`, email: `sales-rep-${tag}@example.com` };
  await sql`INSERT INTO companies(id,name) VALUES(${a},'Sales test company')`;
  await sql`INSERT INTO projects(id,company_id,name) VALUES(${project},${a},'Sales project')`;
  await sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${a},${admin.userId},${admin.email},'company_admin'),(${a},${manager.userId},${manager.email},'sales_manager'),(${a},${rep.userId},${rep.email},'sales')`;
  const customer = await crm.createCustomer(tenantSql(sql), admin, { company_id: a, full_name: 'Pipeline Customer', phone: `+20101${tag}`, email: `pipeline-${tag}@example.com` });
  const lead = await crm.createLead(tenantSql(sql), rep, { company_id: a, customer_id: customer.id, source: 'referral', owner_user_id: rep.userId });
  const overview = await sales.salesOverview(tenantSql(sql), manager, a);
  const first = overview.stages[0], second = overview.stages[1];
  await check('pipeline stages are seeded for each company', () => assert.ok(overview.stages.length >= 6));
  await check('sales rep moves an owned lead between stages', async () => { const moved = await sales.moveLeadStage(tenantSql(sql), rep, { company_id: a, lead_id: lead.id, stage_id: second.id, version: lead.version, reason: 'Customer requested a proposal' }); assert.equal(moved.stage_id, second.id); });
  let team;
  await check('sales manager creates a team', async () => { team = await sales.saveSalesTeam(tenantSql(sql), manager, { company_id: a, name: 'North team', manager_user_id: manager.userId }); assert.equal(team.manager_user_id, manager.userId); });
  await check('authorized admin assigns a team member and the manager transfers a lead', async () => { await sales.addTeamMember(tenantSql(sql), admin, { company_id: a, team_id: team.id, user_id: rep.userId }); const moved = await sales.transferLead(tenantSql(sql), manager, { company_id: a, lead_id: lead.id, to_user_id: manager.userId, reason: 'Team reassignment' }); assert.equal(moved.owner_user_id, manager.userId); });
  let follow;
  await check('follow-up completion is recorded', async () => { follow = await crm.addFollowUp(tenantSql(sql), rep, { company_id: a, customer_id: customer.id, due_at: new Date(Date.now() + 3600000).toISOString(), title: 'Confirm viewing' }); const done = await sales.updateFollowUp(tenantSql(sql), rep, { company_id: a, id: follow.id, status: 'done' }); assert.equal(done.status, 'done'); });
  await check('sales operations leave auditable history', async () => { const rows = await sql`SELECT action FROM audit_logs WHERE company_id=${a} AND action LIKE 'crm.%' ORDER BY id`; assert.ok(rows.some(row => row.action === 'crm.lead_stage_changed')); assert.ok(rows.some(row => row.action === 'crm.lead_transferred')); });
  return { passed: checks.length, checks, fixture_companies: [a] };
}
