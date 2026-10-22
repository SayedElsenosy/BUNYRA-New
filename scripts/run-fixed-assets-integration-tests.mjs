import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const sql=neon(process.env.BUNYRA_TEST_DATABASE_URL),id=()=>crypto.randomUUID();
const company=id(),foreign=id(),entity=id(),asset=id(),cost=id(),accum=id(),expense=id(),journal=id();
const actor='asset-test-'+company.slice(0,8),outsider='asset-outsider-'+foreign.slice(0,8);
const responses=await sql.transaction([
 sql`SAVEPOINT bunyra_asset_fixture`,
 sql`INSERT INTO companies(id,name) VALUES(${company},'Fixed asset test'),(${foreign},'Foreign asset test')`,
 sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES
 (${company},${actor},'assets@example.test','company_admin'),
 (${foreign},${outsider},'foreign-assets@example.test','company_admin')`,
 sql`INSERT INTO ledger_entities(id,company_id,code,name) VALUES(${entity},${company},'AST','Asset test legal entity')`,
 sql`INSERT INTO ledger_accounts(id,company_id,entity_id,code,name,kind) VALUES
 (${cost},${company},${entity},'AST110','Equipment','asset'),
 (${accum},${company},${entity},'AST119','Accumulated depreciation','asset'),
 (${expense},${company},${entity},'AST610','Depreciation expense','expense')`,
 sql`INSERT INTO ledger_journals(id,company_id,entity_id,code,name,kind)
 VALUES(${journal},${company},${entity},'AST','Asset adjustments','adjustment')`,
 sql`INSERT INTO finance_fixed_assets(id,company_id,entity_id,code,name,acquisition_date,service_date,cost_minor,residual_minor,useful_life_months,
 asset_account_id,accumulated_account_id,expense_account_id,journal_id,created_by)
 VALUES(${asset},${company},${entity},'FA-001','Temporary fixture asset','2025-12-15','2026-01-01',100000,10000,7,
 ${cost},${accum},${expense},${journal},${actor})`,
 sql`SELECT set_config('app.company_id',${company},true),set_config('app.user_id',${actor},true)`,
 sql`SET LOCAL ROLE bunyra_tenant`,
 sql`SELECT bunyra_post_asset_depreciation(${company}::uuid,${asset}::uuid,'2026-01-01'::date) AS entry_id`,
 sql`SELECT bunyra_post_asset_depreciation(${company}::uuid,${asset}::uuid,'2026-01-01'::date) AS entry_id`,
 sql`SELECT count(*)::int n,sum(amount_minor)::text total FROM finance_asset_depreciations WHERE company_id=${company}`,
 sql`SELECT e.state,sum(l.debit_minor)::text debit,sum(l.credit_minor)::text credit
 FROM ledger_entries e JOIN ledger_lines l ON l.entry_id=e.id AND l.company_id=e.company_id AND l.entity_id=e.entity_id
 WHERE e.company_id=${company} AND e.source_type='asset' GROUP BY e.state`,
 sql`SELECT bunyra_lock_ledger_period(${company}::uuid,${entity}::uuid,'2026-02-01'::date,'2026-02-28'::date,'Accounting period closure test')`,
 sql`DO $assetassert$
 DECLARE cid uuid:=current_setting('app.company_id')::uuid; aid uuid;
 BEGIN
 SELECT id INTO aid FROM finance_fixed_assets WHERE company_id=cid AND code='FA-001';
 BEGIN
  PERFORM bunyra_post_asset_depreciation(cid,aid,'2026-03-01'::date);
  RAISE EXCEPTION 'MISSING_SEQUENCE_GUARD' USING ERRCODE='P0001';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'ASSET_DEPRECIATION_SEQUENCE' THEN RAISE; END IF; END;
 BEGIN
  PERFORM bunyra_post_asset_depreciation(cid,aid,'2026-02-01'::date);
  RAISE EXCEPTION 'MISSING_CLOSE_GUARD' USING ERRCODE='P0001';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'LEDGER_PERIOD_LOCKED' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO ledger_entries(company_id,entity_id,journal_id,entry_date,reference,source_type,source_id,source_event,idempotency_key,payload_hash,created_by)
  SELECT company_id,entity_id,journal_id,(date_trunc('month',current_timestamp AT TIME ZONE 'Africa/Cairo')+interval '1 month')::date,
   'FORBIDDEN:FUTURE','asset',id,'depreciation_999912','futureasset:'||id::text,repeat('a',64),current_setting('app.user_id')
  FROM finance_fixed_assets WHERE company_id=cid AND id=aid;
  RAISE EXCEPTION 'MISSING_FUTURE_GUARD' USING ERRCODE='P0001';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'ASSET_FUTURE_PERIOD' THEN RAISE; END IF; END;
 END $assetassert$`,
 sql`SELECT count(*)::int n FROM finance_asset_depreciations WHERE company_id=${company}`,
 sql`SELECT set_config('app.user_id',${outsider},true)`,
 sql`SELECT count(*)::int n FROM finance_fixed_assets WHERE company_id=${company}`,
 sql`ROLLBACK TO SAVEPOINT bunyra_asset_fixture`,
 sql`SELECT count(*)::int n FROM companies WHERE id IN(${company},${foreign})`,
 sql`SELECT count(*)::int n FROM finance_fixed_assets WHERE id=${asset}`
]);
assert.equal(responses[9][0].entry_id,responses[10][0].entry_id,'duplicate month must return the same journal');
assert.deepEqual(responses[11],[{n:1,total:'12858'}],'exact monthly depreciation');
assert.deepEqual(responses[12],[{state:'posted',debit:'12858',credit:'12858'}],'double-entry journal');
assert.equal(responses[15][0].n,1,'out-of-sequence/locked/future periods blocked');
assert.equal(responses[17][0].n,0,'cross-tenant record isolation');
assert.equal(responses[19][0].n,0,'company fixtures rolled back');
assert.equal(responses[20][0].n,0,'asset fixtures rolled back');
console.log(JSON.stringify({passed:7,rolled_back:true},null,2));
