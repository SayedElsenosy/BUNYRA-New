import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';

await assertFixtureDatabaseTarget();
const sql=neon(process.env.BUNYRA_TEST_DATABASE_URL);
const migration=await sql`SELECT version FROM schema_migrations WHERE version='048-supplier-payment-vendor-link'`;
assert.equal(migration.length,1,'Apply reviewed migration 048 on isolated dev-foundation first');

// All fixtures, journals and audit records live in one transaction and are rolled back.
const company=crypto.randomUUID(),entity=crypto.randomUUID(),bill=crypto.randomUUID();
const vendor=crypto.randomUUID(),payable=crypto.randomUUID(),cash=crypto.randomUUID();
const expense=crypto.randomUUID(),purchase=crypto.randomUUID(),cashJournal=crypto.randomUUID();
const actor='payment-test-'+company.slice(0,8);
const expectFailure=(statement,message)=>`BEGIN
 ${statement};
 RAISE EXCEPTION 'EXPECTED_FAILURE_MISSING: ${message}';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM <> '${message}' THEN RAISE; END IF;
 END;`;
const payment=(amount,key='fixture-payment-01',journal=cashJournal)=>
 `PERFORM bunyra_pay_vendor_bill('${company}','${bill}','${journal}','${cash}','2026-01-15',${amount},'${key}')`;
const responses=await sql.transaction([
 sql`SAVEPOINT supplier_payment_fixture`,
 sql`INSERT INTO companies(id,name) VALUES(${company},'Rollback-only supplier payment tests')`,
 sql`INSERT INTO memberships(company_id,user_id,email,role)
 VALUES(${company},${actor},'payments@example.test','finance_manager')`,
 sql`INSERT INTO ledger_entities(id,company_id,code,name) VALUES(${entity},${company},'PAY','Payments test')`,
 sql`INSERT INTO ledger_accounts(id,company_id,entity_id,code,name,kind,role) VALUES
 (${payable},${company},${entity},'2100','Payables','liability','payable'),
 (${cash},${company},${entity},'1100','Cash','asset','cash'),
 (${expense},${company},${entity},'5100','Services','expense','general')`,
 sql`INSERT INTO ledger_journals(id,company_id,entity_id,code,name,kind) VALUES
 (${purchase},${company},${entity},'PUR','Purchases','purchase'),
 (${cashJournal},${company},${entity},'CASH','Cash payments','cash')`,
 sql`INSERT INTO finance_vendors(id,company_id,code,name,created_by)
 VALUES(${vendor},${company},'V01','Fixture supplier',${actor})`,
 sql`INSERT INTO finance_payable_mappings(company_id,entity_id,journal_id,payable_account_id,updated_by)
 VALUES(${company},${entity},${purchase},${payable},${actor})`,
 sql`INSERT INTO finance_vendor_bills(id,company_id,entity_id,vendor_id,invoice_number,invoice_date,due_date,total_minor,created_by)
 VALUES(${bill},${company},${entity},${vendor},'TEST-01','2026-01-01','2026-01-31',10000,${actor})`,
 sql`INSERT INTO finance_vendor_bill_lines(company_id,entity_id,bill_id,line_number,expense_account_id,description,amount_minor)
 VALUES(${company},${entity},${bill},1,${expense},'Fixture services',10000)`,
 sql`SELECT set_config('app.company_id',${company},true),set_config('app.user_id',${actor},true)`,
 sql`SET LOCAL ROLE bunyra_tenant`,
 sql.query(`DO $test$ BEGIN ${expectFailure(payment(4000),'VENDOR_PAYMENT_REQUIRES_POSTED_BILL')} END $test$`),
 sql`UPDATE finance_vendor_bills SET status='approved',approved_by=${actor},approved_at=now() WHERE id=${bill}`,
 sql`SELECT bunyra_post_vendor_bill(${company}::uuid,${bill}::uuid)`,
 sql`SELECT bunyra_pay_vendor_bill(${company}::uuid,${bill}::uuid,${cashJournal}::uuid,${cash}::uuid,'2026-01-15',4000,'fixture-payment-01') AS id`,
 sql`SELECT bunyra_pay_vendor_bill(${company}::uuid,${bill}::uuid,${cashJournal}::uuid,${cash}::uuid,'2026-01-15',4000,'fixture-payment-01') AS id`,
 sql.query(`DO $test$ BEGIN
 ${expectFailure(payment(4001),'VENDOR_PAYMENT_IDEMPOTENCY_CONFLICT')}
 ${expectFailure(payment(6001,'fixture-overpayment'),'VENDOR_PAYMENT_OVERPAID')}
 ${expectFailure(payment(1000,'fixture-wrong-journal',purchase),'VENDOR_PAYMENT_MAPPING_INVALID')}
 END $test$`),
 sql`SELECT bunyra_pay_vendor_bill(${company}::uuid,${bill}::uuid,${cashJournal}::uuid,${cash}::uuid,'2026-01-15',6000,'fixture-payment-02') AS id`,
 sql.query(`DO $test$ BEGIN ${expectFailure(payment(1,'fixture-paid-in-full'),'VENDOR_PAYMENT_OVERPAID')} END $test$`),
 sql`SELECT count(*)::int n,sum(amount_minor)::text amount FROM finance_vendor_payments WHERE company_id=${company}`,
 sql`SELECT sum(l.debit_minor)::text debit,sum(l.credit_minor)::text credit,count(DISTINCT e.id)::int entries
 FROM finance_vendor_payments p JOIN ledger_entries e ON e.id=p.posted_entry_id
 JOIN ledger_lines l ON l.entry_id=e.id WHERE p.company_id=${company} AND e.state='posted'`,
 sql`SELECT count(*)::int n FROM audit_logs WHERE company_id=${company} AND action='finance.vendor_bill_payment_posted'`,
 sql`SELECT count(*)::int vendor_lines FROM ledger_lines l JOIN finance_vendor_payments p ON p.posted_entry_id=l.entry_id
 WHERE p.company_id=${company} AND l.vendor_id=${vendor}`,
 sql`SELECT sum(l.credit_minor-l.debit_minor)::text outstanding FROM ledger_lines l
 JOIN ledger_entries e ON e.id=l.entry_id AND e.company_id=l.company_id
 WHERE l.company_id=${company} AND l.vendor_id=${vendor} AND l.account_id=${payable} AND e.state='posted'`,
 sql`SELECT set_config('app.user_id','unauthorized-payment-actor',true)`,
 sql`SELECT count(*)::int n FROM finance_vendor_payments WHERE company_id=${company}`,
 sql.query(`DO $test$ BEGIN ${expectFailure(payment(1,'fixture-forbidden'),'VENDOR_PAYMENT_FORBIDDEN')} END $test$`),
 sql`ROLLBACK TO SAVEPOINT supplier_payment_fixture`,
 sql`SELECT count(*)::int n FROM companies WHERE id=${company}`,
 sql`SELECT count(*)::int n FROM finance_vendor_payments WHERE company_id=${company}`
]);
assert.equal(responses[15][0].id,responses[16][0].id,'retry returns original payment');
assert.deepEqual(responses[20],[{n:2,amount:'10000'}],'partial payments settle exact outstanding amount');
assert.deepEqual(responses[21],[{debit:'10000',credit:'10000',entries:2}],'payments create balanced posted journals');
assert.deepEqual(responses[22],[{n:2}],'retry does not duplicate audit');
assert.deepEqual(responses[23],[{vendor_lines:4}],'both sides of supplier payments retain supplier identity');
assert.deepEqual(responses[24],[{outstanding:'0'}],'supplier payable subledger clears on full settlement');
assert.deepEqual(responses[26],[{n:0}],'unauthorized actor cannot see payments');
assert.deepEqual(responses[29],[{n:0}],'company fixtures rolled back');
assert.deepEqual(responses[30],[{n:0}],'payment fixtures rolled back');
console.log(JSON.stringify({passed:15,rolled_back:true,scope:'supplier partial payments, retry, overpayment, role/RLS, balanced GL and supplier balances'},null,2));
