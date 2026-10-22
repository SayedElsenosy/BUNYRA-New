import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';

await assertFixtureDatabaseTarget();
const sql=neon(process.env.BUNYRA_TEST_DATABASE_URL);
assert.equal((await sql`SELECT version FROM schema_migrations WHERE version='046-project-budgets'`).length,1,
 'Apply reviewed migration 046 on isolated dev-foundation first');
const company=crypto.randomUUID(),entity=crypto.randomUUID(),project=crypto.randomUUID();
const expense=crypto.randomUUID(),first=crypto.randomUUID(),second=crypto.randomUUID();
const actor='budget-test-'+company.slice(0,8);
const results=await sql.transaction([
 sql`SAVEPOINT budget_fixture`,
 sql`INSERT INTO companies(id,name) VALUES(${company},'Rollback-only project budget tests')`,
 sql`INSERT INTO memberships(company_id,user_id,email,role)
 VALUES(${company},${actor},'budgets@example.test','finance_manager')`,
 sql`INSERT INTO ledger_entities(id,company_id,code,name) VALUES(${entity},${company},'BUD','Budget test')`,
 sql`INSERT INTO projects(id,company_id,name) VALUES(${project},${company},'Budget fixture project')`,
 sql`INSERT INTO ledger_accounts(id,company_id,entity_id,code,name,kind)
 VALUES(${expense},${company},${entity},'5300','Project services','expense')`,
 sql`SELECT set_config('app.company_id',${company},true),set_config('app.user_id',${actor},true)`,
 sql`SET LOCAL ROLE bunyra_tenant`,
 sql`INSERT INTO finance_project_budgets(id,company_id,entity_id,project_id,expense_account_id,period_month,version,amount_minor,reason,created_by)
 VALUES(${first},${company},${entity},${project},${expense},'2026-01-01',1,10000,'Original budget fixture',${actor})`,
 sql`SELECT bunyra_approve_project_budget(${company}::uuid,${first}::uuid) AS id`,
 sql`SELECT bunyra_approve_project_budget(${company}::uuid,${first}::uuid) AS id`,
 sql`INSERT INTO finance_project_budgets(id,company_id,entity_id,project_id,expense_account_id,period_month,version,amount_minor,reason,created_by)
 VALUES(${second},${company},${entity},${project},${expense},'2026-01-01',2,15000,'Revised budget fixture',${actor})`,
 sql`SELECT bunyra_approve_project_budget(${company}::uuid,${second}::uuid)`,
 sql`SELECT version,status,amount_minor::text amount FROM finance_project_budgets WHERE company_id=${company} ORDER BY version`,
 sql`SELECT count(*)::int audits FROM audit_logs WHERE company_id=${company} AND action='finance.project_budget_approved'`,
 sql`DO $test$ DECLARE cid uuid:=current_setting('app.company_id')::uuid; BEGIN
 BEGIN
  PERFORM bunyra_approve_project_budget(cid,(SELECT id FROM finance_project_budgets WHERE company_id=cid AND version=1));
  RAISE EXCEPTION 'EXPECTED_SUPERSEDED_REJECTION';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'BUDGET_NOT_DRAFT' THEN RAISE; END IF; END;
 END $test$`,
 sql`RESET ROLE`,
 sql`DO $test$ DECLARE cid uuid:=current_setting('app.company_id')::uuid; BEGIN
 BEGIN
  UPDATE finance_project_budgets SET amount_minor=amount_minor+1 WHERE company_id=cid;
  RAISE EXCEPTION 'EXPECTED_IMMUTABILITY';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'BUDGET_IMMUTABLE' THEN RAISE; END IF; END;
 BEGIN
  DELETE FROM finance_project_budgets WHERE company_id=cid;
  RAISE EXCEPTION 'EXPECTED_DELETE_REJECTION';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'BUDGET_DELETE_FORBIDDEN' THEN RAISE; END IF; END;
 END $test$`,
 sql`SET LOCAL ROLE bunyra_tenant`,
 sql`SELECT set_config('app.user_id','unauthorized-budget-actor',true)`,
 sql`SELECT count(*)::int visible FROM finance_project_budgets WHERE company_id=${company}`,
 sql.query(`DO $test$ BEGIN
 BEGIN
  PERFORM bunyra_approve_project_budget('${company}','${second}');
  RAISE EXCEPTION 'EXPECTED_PERMISSION_REJECTION';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'BUDGET_FORBIDDEN' THEN RAISE; END IF; END;
 END $test$`),
 sql`ROLLBACK TO SAVEPOINT budget_fixture`,
 sql`SELECT count(*)::int companies FROM companies WHERE id=${company}`,
 sql`SELECT count(*)::int budgets FROM finance_project_budgets WHERE company_id=${company}`
]);
assert.equal(results[9][0].id,results[10][0].id,'approval retry returns original budget');
assert.deepEqual(results[13],[{version:1,status:'superseded',amount:'10000'},{version:2,status:'approved',amount:'15000'}],
 'approved revision supersedes the original without rewriting amount');
assert.deepEqual(results[14],[{audits:2}],'retry approval does not duplicate audit');
assert.deepEqual(results[20],[{visible:0}],'unauthorized actor cannot read budgets');
assert.deepEqual(results[23],[{companies:0}],'company fixture rolled back');
assert.deepEqual(results[24],[{budgets:0}],'budget fixture rolled back');
console.log(JSON.stringify({passed:10,rolled_back:true,scope:'budget approval, immutable revisions, audit retry and tenant/role isolation'},null,2));
