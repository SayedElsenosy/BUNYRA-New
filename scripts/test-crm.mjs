import assert from 'node:assert/strict';
import { tenantSql } from '../.sites-runtime/tests/tenant.mjs';
import * as crm from '../.sites-runtime/tests/crm.mjs';

export async function runCrmTests(sql) {
  const checks = [];
  const check = async (name, fn) => { await fn(); checks.push({ name, passed: true }); };
  const reject = (fn, code) => assert.rejects(fn, error => !code || error.code === code);
  const a = crypto.randomUUID(), b = crypto.randomUUID(), project = crypto.randomUUID();
  const tag = a.slice(0, 8);
  const admin = { userId: `crm-admin-${tag}`, email: `crm-admin-${tag}@example.com` };
  const sales = { userId: `crm-sales-${tag}`, email: `crm-sales-${tag}@example.com` };
  const accountant = { userId: `crm-accountant-${tag}`, email: `crm-accountant-${tag}@example.com` };
  await sql`INSERT INTO companies(id,name) VALUES(${a},'CRM test A'),(${b},'CRM test B')`;
  await sql`INSERT INTO projects(id,company_id,name) VALUES(${project},${a},'CRM project')`;
  await sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES(${a},${admin.userId},${admin.email},'company_admin'),(${a},${sales.userId},${sales.email},'sales'),(${a},${accountant.userId},${accountant.email},'accountant')`;

  let customer;
  await check('admin creates a customer', async () => {
    customer = await crm.createCustomer(tenantSql(sql), admin, { company_id: a, full_name: 'CRM Customer', phone: '+20 100 111 2222', email: `crm-${tag}@example.com`, address: 'Cairo', notes: 'Initial contact' });
    assert.equal(customer.full_name, 'CRM Customer');
  });
  await check('duplicate normalized phone is rejected', () => reject(() => crm.createCustomer(tenantSql(sql), admin, { company_id: a, full_name: 'Duplicate Customer', phone: '+201001112222', email: '' })));
  await check('sales can read and create a lead', async () => {
    const view = await crm.crmOverview(tenantSql(sql), sales, a);
    assert.equal(view.customers.length, 1);
    const lead = await crm.createLead(tenantSql(sql), sales, { company_id: a, customer_id: customer.id, source: 'website', interest: 'Residential unit' });
    assert.equal(lead.owner_user_id, sales.userId);
  });
  await check('accountant cannot access CRM leads', () => reject(() => crm.crmOverview(tenantSql(sql), accountant, a), 'FORBIDDEN'));
  await check('cross-company customer access is denied', () => reject(() => crm.crmOverview(tenantSql(sql), admin, b), 'FORBIDDEN'));
  await check('sales can record interaction and follow-up', async () => {
    const view = await crm.crmOverview(tenantSql(sql), sales, a);
    const lead = view.customers[0].leads[0];
    await crm.addInteraction(tenantSql(sql), sales, { company_id: a, customer_id: customer.id, lead_id: lead.id, kind: 'call', body: 'Discussed requirements' });
    await crm.addFollowUp(tenantSql(sql), sales, { company_id: a, customer_id: customer.id, lead_id: lead.id, due_at: new Date(Date.now() + 86400000).toISOString(), title: 'Send matching units' });
    const after = await crm.crmOverview(tenantSql(sql), sales, a);
    assert.equal(after.interactions.length, 1);
    assert.equal(after.followUps.length, 1);
  });
  await check('tenant role cannot read another company CRM rows', async () => {
    const result = await sql.transaction([sql`SET LOCAL ROLE bunyra_tenant`, sql`SELECT set_config('app.company_id',${b},true),set_config('app.user_id',${admin.userId},true)`, sql`SELECT id FROM crm_customers`]);
    assert.equal(result[2].length, 0);
  });
  await check('CRM operations write audit records', async () => {
    const rows = await sql`SELECT action FROM audit_logs WHERE company_id=${a} AND action LIKE 'crm.%' ORDER BY id`;
    assert.deepEqual(rows.map(row => row.action), ['crm.customer_created', 'crm.lead_created', 'crm.interaction_added', 'crm.follow_up_created']);
  });
  await check('creating a customer initializes exactly one Fresh stage without separate opportunity',async()=>{
    const newCustomer=await crm.createCustomer(tenantSql(sql),sales,{company_id:a,full_name:'Unified Customer',phone:'+201012345999',email:''},false,true);
    const rows=await sql`SELECT id,customer_id,stage_code,status,source,owner_user_id FROM crm_leads WHERE company_id=${a} AND customer_id=${newCustomer.id}`;
    assert.equal(rows.length,1);
    assert.equal(rows[0].customer_id,newCustomer.id);
    assert.equal(rows[0].stage_code,'fresh');
    assert.equal(rows[0].status,'new');
    assert.equal(rows[0].source,'customer_record');
    assert.equal(rows[0].owner_user_id,sales.userId);
  });
  return { passed: checks.length, checks, fixture_companies: [a, b] };
}
