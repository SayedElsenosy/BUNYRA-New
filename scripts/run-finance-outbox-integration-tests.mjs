import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
const sql=neon(process.env.BUNYRA_TEST_DATABASE_URL);
assert.equal((await sql`SELECT version FROM schema_migrations WHERE version='055-live-finance-authorization'`).length,1,
 'Apply migrations 050–055 to isolated dev-foundation first');
const id=()=>crypto.randomUUID(),company=id(),foreign=id(),conflict=id(),receipt=id(),refund=id(),locked=id(),info=id();
const automatic=id(),revoked=id(),disabled=id(),foreignEvent=id(),actor='outbox-'+company.slice(0,8);
const scheduled=id(),immediateLocked=id(),sourceActor='source-handler-'+company.slice(0,8);
const project=id(),overrideEvent=id(),customEvent=id(),customRole=id(),projectEvent=id();
const entity=`(SELECT id FROM ledger_entities WHERE company_id='${company}' AND is_default)`;
const setup=`SELECT bunyra_initialize_accounting('${company}',${entity},'ar','cash')`;
const expected=(statement,message)=>`BEGIN ${statement}; RAISE EXCEPTION 'EXPECTED_FAILURE_MISSING';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM <> '${message}' THEN RAISE; END IF; END;`;
const denied=statement=>`BEGIN ${statement}; RAISE EXCEPTION 'EXPECTED_PERMISSION_REJECTION';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;`;
const event=(eventId,kind,date,amount,companyId=company,projectId=null)=>sql`INSERT INTO finance_events
 (id,company_id,source_kind,source_id,event_type,processing_kind,status,amount_minor,event_at,project_id)
 VALUES(${eventId},${companyId},'collection',${id()},${kind==='cash_refunded'?'adjustment_refund_executed':kind==='informational'?'booking_cancelled':'collection_confirmed'},
 ${kind},${kind==='informational'?'informational':'pending'},${amount},${date}::timestamptz,${projectId})`;
const result=await sql.transaction([
 sql`SAVEPOINT finance_outbox_fixture`,
 sql`INSERT INTO companies(id,name) VALUES(${company},'Outbox rollback test'),(${foreign},'Disabled outbox tenant'),(${conflict},'Chart conflict rollback test')`,
 sql`INSERT INTO memberships(company_id,user_id,email,role) VALUES
 (${company},${actor},'outbox@example.test','finance_manager'),
 (${conflict},${actor},'outbox@example.test','finance_manager'),
 (${foreign},'outbox-foreign-actor','foreign-outbox@example.test','company_admin')`,
 sql`INSERT INTO company_settings(company_id,time_zone) VALUES(${company},'Africa/Cairo')`,
 sql`INSERT INTO projects(id,company_id,name) VALUES(${project},${company},'Restricted posting project')`,
 event(receipt,'cash_received','2026-01-31T22:30:00Z',12345),
 event(info,'informational','2026-01-01T12:00:00Z',0),
 sql`SELECT set_config('app.company_id',${company},true),set_config('app.user_id',${actor},true)`,
 sql`SET LOCAL ROLE bunyra_tenant`,
 sql.query(`${setup.replace('SELECT','SELECT \'setup\' AS tag,') } AS value`),
 sql.query(`${setup.replace('SELECT','SELECT \'repeat_setup\' AS tag,')} AS value`),
 sql`SELECT 'empty_ledger' AS tag,count(*)::int n FROM ledger_entries WHERE company_id=${company}`,
 sql.query(`SELECT bunyra_lock_ledger_period('${company}',${entity},'2026-01-01','2026-01-31','Closed January test')`),
 sql.query(`DO $test$ BEGIN
 ${expected(`PERFORM bunyra_lock_ledger_period('${company}',${entity},'2026-02-01','2026-02-28','Pending February test')`,'LEDGER_PERIOD_PENDING_EVENTS')}
 ${expected(`PERFORM bunyra_initialize_accounting('${company}',${entity},'ar','bank')`,'ACCOUNTING_TEMPLATE_MAPPING_CONFLICT')}
 END $test$`),
 sql`SELECT 'first_batch' AS tag,bunyra_process_finance_outbox(${company}::uuid,1) AS value`,
 sql`SELECT 'repeat_batch' AS tag,bunyra_process_finance_outbox(${company}::uuid,10) AS value`,
 sql`SELECT 'receipt_date' AS tag,e.entry_date::text date,e.state FROM finance_events f JOIN ledger_entries e ON e.id=f.ledger_entry_id WHERE f.id=${receipt}`,
 sql`RESET ROLE`,
 event(refund,'cash_refunded','2026-02-02T12:00:00Z',345),
 event(locked,'cash_received','2026-01-15T12:00:00Z',100),
 sql`SET LOCAL ROLE bunyra_tenant`,
 sql`SELECT 'mixed_batch' AS tag,bunyra_process_finance_outbox(${company}::uuid,10) AS value`,
 sql`SELECT 'backoff_batch' AS tag,bunyra_process_finance_outbox(${company}::uuid,10) AS value`,
 sql`SELECT 'failure' AS tag,processing_attempts,last_error_code,next_attempt_at>now() delayed,status FROM finance_events WHERE id=${locked}`,
 sql`SELECT 'balance' AS tag,sum(l.debit_minor)::text debit,sum(l.credit_minor)::text credit,count(DISTINCT e.id)::int entries
 FROM ledger_entries e JOIN ledger_lines l ON l.entry_id=e.id WHERE e.company_id=${company} AND e.state='posted'`,
 sql`SELECT 'advance_balance' AS tag,sum(l.credit_minor-l.debit_minor)::text amount FROM ledger_lines l
 JOIN ledger_accounts a ON a.id=l.account_id WHERE l.company_id=${company} AND a.role='customer_advance'`,
 sql`SELECT 'no_income' AS tag,count(*)::int n FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.account_id WHERE l.company_id=${company} AND a.kind='income'`,
 sql`SELECT 'no_failed_journal' AS tag,count(*)::int n FROM ledger_entries WHERE company_id=${company} AND idempotency_key=${'finance:'+locked}`,
 sql.query(`DO $test$ BEGIN
 ${expected(`PERFORM bunyra_retry_finance_event('${company}','${receipt}')`,'FINANCE_EVENT_NOT_RETRYABLE')}
 ${expected(`PERFORM bunyra_retry_finance_event('${company}','${info}')`,'FINANCE_EVENT_NOT_RETRYABLE')}
 ${expected(`PERFORM bunyra_process_finance_outbox('${company}',51)`,'FINANCE_BATCH_INVALID')}
 ${denied('PERFORM bunyra_run_scheduled_finance_outbox()')}
 ${denied(`PERFORM bunyra_attempt_finance_event('${company}','${receipt}')`)}
 ${denied(`INSERT INTO finance_events(company_id,source_kind,source_id,event_type,processing_kind,status,amount_minor) VALUES('${company}','collection','${id()}','collection_confirmed','cash_received','pending',100)`)}
 ${denied(`UPDATE finance_automation_settings SET enabled=true WHERE company_id='${company}'`)}
 ${denied(`UPDATE finance_event_attempts SET attempt_number=100 WHERE company_id='${company}'`)}
 END $test$`),
 sql`RESET ROLE`,
 sql.query(`DO $test$ BEGIN FOR i IN 1..7 LOOP
 UPDATE finance_events SET next_attempt_at=now() WHERE id='${locked}';
 PERFORM bunyra_process_finance_outbox('${company}',10); END LOOP; END $test$`),
 sql`SELECT 'blocked' AS tag,processing_attempts,last_error_code FROM finance_events WHERE id=${locked}`,
 sql`SELECT 'blocked_batch' AS tag,bunyra_process_finance_outbox(${company}::uuid,10) AS value`,
 sql`SELECT bunyra_retry_finance_event(${company}::uuid,${locked}::uuid)`,
 sql`SELECT 'reset' AS tag,processing_attempts,last_error_code FROM finance_events WHERE id=${locked}`,
 sql`SELECT bunyra_process_finance_outbox(${company}::uuid,10)`,
 sql`SELECT 'retained_attempts' AS tag,count(*)::int n FROM finance_event_attempts WHERE event_id=${locked}`,
 sql.query(`DO $test$ BEGIN
 ${expected(`UPDATE finance_event_attempts SET attempt_number=999 WHERE company_id='${company}'`,'FINANCE_ATTEMPT_IMMUTABLE')}
 ${expected(`DELETE FROM finance_event_attempts WHERE company_id='${company}'`,'FINANCE_ATTEMPT_IMMUTABLE')}
 END $test$`),
 event(scheduled,'cash_received','2026-02-02T12:00:00Z',100),
 sql`SELECT bunyra_configure_finance_automation(${company}::uuid,true)`,
 sql`SELECT set_config('app.user_id',${sourceActor},true)`,
 event(automatic,'cash_received','2026-02-02T12:00:00Z',100),
 sql`SELECT 'immediate' AS tag,status FROM finance_events WHERE id=${automatic}`,
 event(immediateLocked,'cash_received','2026-01-15T12:00:00Z',50),
 sql`SELECT 'immediate_failure' AS tag,status,processing_attempts,last_error_code FROM finance_events WHERE id=${immediateLocked}`,
 event(foreignEvent,'cash_received','2026-02-02T12:00:00Z',100,foreign),
 sql`SELECT bunyra_run_scheduled_finance_outbox()`,
 sql`SELECT 'automatic' AS tag,f.status,a.automatic FROM finance_events f JOIN finance_event_attempts a ON a.event_id=f.id WHERE f.id=${automatic}`,
 sql`SELECT 'context' AS tag,current_setting('app.company_id') company,current_setting('app.user_id') actor`,
 sql`SELECT 'scheduled' AS tag,f.status,a.automatic FROM finance_events f JOIN finance_event_attempts a ON a.event_id=f.id WHERE f.id=${scheduled}`,
 sql`SELECT set_config('app.user_id',${actor},true)`,
 sql`SELECT 'foreign_pending' AS tag,status,processing_attempts FROM finance_events WHERE id=${foreignEvent}`,
 sql`UPDATE memberships SET active=false WHERE company_id=${company} AND user_id=${actor}`,
 event(revoked,'cash_received','2026-02-02T12:00:00Z',100),
 sql`SELECT bunyra_run_scheduled_finance_outbox()`,
 sql`SELECT 'revoked' AS tag,status,processing_attempts FROM finance_events WHERE id=${revoked}`,
 sql`UPDATE memberships SET active=true WHERE company_id=${company} AND user_id=${actor}`,
 sql`INSERT INTO member_permissions(company_id,user_id,action,allowed) VALUES(${company},${actor},'finance.approve',false)`,
 event(overrideEvent,'cash_received','2026-02-02T12:00:00Z',100),
 sql`SELECT bunyra_run_scheduled_finance_outbox()`,
 sql`SELECT 'override_denied' AS tag,status,processing_attempts FROM finance_events WHERE id=${overrideEvent}`,
 sql`DELETE FROM member_permissions WHERE company_id=${company} AND user_id=${actor} AND action='finance.approve'`,
 sql`INSERT INTO custom_roles(id,company_id,name,permissions) VALUES(${customRole},${company},'Finance without approval','{"finance.approve":false}'::jsonb)`,
 sql`UPDATE memberships SET custom_role_id=${customRole} WHERE company_id=${company} AND user_id=${actor}`,
 event(customEvent,'cash_received','2026-02-02T12:00:00Z',100),
 sql`SELECT bunyra_run_scheduled_finance_outbox()`,
 sql`SELECT 'custom_denied' AS tag,status,processing_attempts FROM finance_events WHERE id=${customEvent}`,
 sql`UPDATE memberships SET custom_role_id=NULL WHERE company_id=${company} AND user_id=${actor}`,
 sql`INSERT INTO member_permissions(company_id,user_id,project_id,action,allowed) VALUES(${company},${actor},${project},'finance.approve',false)`,
 event(projectEvent,'cash_received','2026-02-02T12:00:00Z',100,company,project),
 sql`SELECT 'project_denied' AS tag,status,processing_attempts,last_error_code FROM finance_events WHERE id=${projectEvent}`,
 sql`SELECT bunyra_configure_finance_automation(${company}::uuid,false)`,
 event(disabled,'cash_received','2026-02-02T12:00:00Z',100),
 sql`SELECT bunyra_run_scheduled_finance_outbox()`,
 sql`SELECT 'disabled' AS tag,status,processing_attempts FROM finance_events WHERE id=${disabled}`,
 sql`INSERT INTO ledger_accounts(company_id,entity_id,code,name,kind)
 SELECT ${conflict},id,'5120','Conflicting account','asset' FROM ledger_entities WHERE company_id=${conflict} AND is_default`,
 sql`SELECT set_config('app.company_id',${conflict},true)`,
 sql.query(`DO $test$ BEGIN ${expected(`PERFORM bunyra_initialize_accounting('${conflict}',(SELECT id FROM ledger_entities WHERE company_id='${conflict}' AND is_default),'ar','cash')`,'ACCOUNTING_TEMPLATE_CODE_CONFLICT')} END $test$`),
 sql`SELECT 'conflict_accounts' AS tag,count(*)::int n FROM ledger_accounts WHERE company_id=${conflict}`,
 sql`SELECT 'conflict_journals' AS tag,count(*)::int n FROM ledger_journals WHERE company_id=${conflict}`,
 sql`SET LOCAL ROLE bunyra_tenant`,
 sql`SELECT set_config('app.company_id',${company},true),set_config('app.user_id','outbox-foreign-actor',true)`,
 sql`SELECT 'rls_attempts' AS tag,count(*)::int n FROM finance_event_attempts WHERE company_id=${company}`,
 sql.query(`DO $test$ BEGIN ${denied(`PERFORM bunyra_process_finance_outbox('${company}',10)`)} END $test$`),
 sql`ROLLBACK TO SAVEPOINT finance_outbox_fixture`,
 sql`SELECT 'rolled_back' AS tag,count(*)::int n FROM companies WHERE id IN(${company},${foreign},${conflict})`
]);
const rows=result.flat(),get=tag=>{const found=rows.find(r=>r.tag===tag);assert.ok(found,tag);const {tag:_,...rest}=found;return rest;};
const checks=[];const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
check('base chart creates 11 accounts and 5 journals',()=>assert.deepEqual(get('setup').value,{created_accounts:11,created_journals:5,treasury:'cash',already_configured:false}));
check('initialization retry does not duplicate or overwrite records',()=>assert.deepEqual(get('repeat_setup').value,{created_accounts:0,created_journals:0,treasury:'cash',already_configured:true}));
check('initialization creates no opening journals',()=>assert.equal(get('empty_ledger').n,0));
check('due receipt is processed exactly once',()=>assert.deepEqual(get('first_batch').value,{posted:1,failed:0}));
check('repeat processing produces no duplicate journal',()=>assert.deepEqual(get('repeat_batch').value,{posted:0,failed:0}));
check('Cairo boundary posts on company-local date beyond January lock',()=>assert.deepEqual(get('receipt_date'),{date:'2026-02-01',state:'posted'}));
check('one locked event does not block another refund',()=>assert.deepEqual(get('mixed_batch').value,{posted:1,failed:1}));
check('failed posting backs off instead of retrying immediately',()=>assert.deepEqual(get('backoff_batch').value,{posted:0,failed:0}));
check('failure remains visible with a safe error code',()=>assert.deepEqual(get('failure'),{processing_attempts:1,last_error_code:'LEDGER_PERIOD_LOCKED',delayed:true,status:'pending'}));
check('receipt and refund produce balanced GL',()=>assert.deepEqual(get('balance'),{debit:'12690',credit:'12690',entries:2}));
check('refund reduces customer advances exactly',()=>assert.equal(get('advance_balance').amount,'12000'));
check('cash receipts do not invent recognized revenue',()=>assert.equal(get('no_income').n,0));
check('failed posting leaves no partial journal',()=>assert.equal(get('no_failed_journal').n,0));
check('failed processing stops at eight attempts',()=>assert.deepEqual(get('blocked'),{processing_attempts:8,last_error_code:'LEDGER_PERIOD_LOCKED'}));
check('exhausted events are not retried automatically',()=>assert.deepEqual(get('blocked_batch').value,{posted:0,failed:0}));
check('authorized requeue resets retry budget',()=>assert.deepEqual(get('reset'),{processing_attempts:0,last_error_code:null}));
check('requeue retains all previous attempts',()=>assert.equal(get('retained_attempts').n,9));
check('opt-in events post immediately inside their source transaction',()=>assert.deepEqual(get('immediate'),{status:'posted'}));
check('an immediate posting failure preserves the source event',()=>assert.deepEqual(get('immediate_failure'),{status:'pending',processing_attempts:1,last_error_code:'LEDGER_PERIOD_LOCKED'}));
check('immediate processing records automatic provenance',()=>assert.deepEqual(get('automatic'),{status:'posted',automatic:true}));
check('scheduled recovery posts previously pending events',()=>assert.deepEqual(get('scheduled'),{status:'posted',automatic:true}));
check('both processors restore the original business actor',()=>assert.deepEqual(get('context'),{company,actor:sourceActor}));
check('another company is never implicitly enabled',()=>assert.deepEqual(get('foreign_pending'),{status:'pending',processing_attempts:0}));
check('revoking approver stops scheduled processing',()=>assert.deepEqual(get('revoked'),{status:'pending',processing_attempts:0}));
check('company permission denial stops immediate and scheduled posting',()=>assert.deepEqual(get('override_denied'),{status:'pending',processing_attempts:0}));
check('custom role permission changes stop immediate and scheduled posting',()=>assert.deepEqual(get('custom_denied'),{status:'pending',processing_attempts:0}));
check('project approval denial blocks posting without losing the event',()=>assert.deepEqual(get('project_denied'),{status:'pending',processing_attempts:1,last_error_code:'FINANCE_PROJECT_FORBIDDEN'}));
check('disabling automation stops scheduled processing',()=>assert.deepEqual(get('disabled'),{status:'pending',processing_attempts:0}));
check('incompatible account code preserves original chart atomically',()=>{assert.equal(get('conflict_accounts').n,1);assert.equal(get('conflict_journals').n,0);});
check('foreign actor cannot see attempts',()=>assert.equal(get('rls_attempts').n,0));
check('all transaction fixtures and journals rolled back',()=>assert.equal(get('rolled_back').n,0));
const guards=['posted events cannot be requeued','informational events cannot be requeued','batch size is bounded',
 'tenant cannot run global scheduler','tenant cannot call internal attempt function','tenant cannot forge finance events',
 'tenant cannot bypass automation settings','tenant cannot rewrite attempts','attempts are immutable even to server role',
 'attempts cannot be deleted even by server role','foreign actor cannot process company queue',
 'period close recognizes pending events on company-local date','template never replaces an existing different receipt mapping'];
console.log(JSON.stringify({passed:checks.length+guards.length,checks,guards,rolled_back:true},null,2));
