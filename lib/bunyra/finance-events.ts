import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';

async function managerAccess(sql:Sql,actor:Actor,company:string,action:'finance.read'|'finance.write'|'finance.approve',platform:boolean){
 const scope=await access(sql,actor,company,action,platform);
 if(!scope.owner&&!['finance_manager','company_admin'].includes(scope.role))throw new ServiceError('FORBIDDEN',403);
}
const configuration=z.object({
 company_id:uuid,entity_id:uuid,journal_id:uuid,
 cash_account_id:uuid,advance_account_id:uuid
}).strict();
const postEvent=z.object({company_id:uuid,event_id:uuid}).strict();

export async function financeEventsOverview(sql:Sql,actor:Actor,company:string,platform=false){
 await managerAccess(sql,actor,company,'finance.read',platform);
 const [events,mappings,automation,queue,attempts,receipt_controls]=await Promise.all([
  sql`SELECT id,source_kind,source_id,event_type,processing_kind,status,
     project_id,customer_id,contract_id,amount_minor::text,event_at,
     ledger_entry_id,created_at,processing_attempts,last_attempt_at,next_attempt_at,last_error_code FROM finance_events
     WHERE company_id=${company} ORDER BY (status='pending') DESC,(processing_attempts>=8) DESC,
      (last_error_code IS NOT NULL) DESC,created_at,id LIMIT 300`,
  sql`SELECT company_id,entity_id,journal_id,cash_account_id,advance_account_id,updated_at
     FROM finance_account_mappings WHERE company_id=${company}`,
  sql`SELECT enabled,authorized_by,updated_at,last_run_at,last_run_result FROM finance_automation_settings WHERE company_id=${company}`,
  sql`SELECT count(*) FILTER(WHERE processing_attempts=0)::int AS waiting,
    count(*) FILTER(WHERE processing_attempts BETWEEN 1 AND 7)::int AS retrying,
    count(*) FILTER(WHERE processing_attempts>=8)::int AS blocked
   FROM finance_events WHERE company_id=${company} AND status='pending'`,
  sql`SELECT a.id,a.event_id,e.event_type,a.attempt_number,a.outcome,a.error_code,a.automatic,a.created_at
   FROM finance_event_attempts a JOIN finance_events e ON e.company_id=a.company_id AND e.id=a.event_id
   WHERE a.company_id=${company} ORDER BY a.created_at DESC,a.id DESC LIMIT 50`,
  sql`SELECT entity_id,advance_account_id FROM finance_receipt_controls WHERE company_id=${company}`
 ]);
 return {events,mappings,attempts,receipt_controls,automation:automation[0]||{enabled:false},queue:queue[0],posting_scope:'cash_and_customer_advances_only',
   informational_events_do_not_create_journal_entries:true};
}
const processBatch=z.object({company_id:uuid,limit:z.number().int().min(1).max(50).default(10)}).strict();
const autoConfig=z.object({company_id:uuid,enabled:z.boolean()}).strict();
export async function processFinanceOutbox(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=processBatch.parse(input);await managerAccess(sql,actor,c.company_id,'finance.approve',platform);
 const [row]=await sql`SELECT bunyra_process_finance_outbox(${c.company_id}::uuid,${c.limit}::integer) AS result`;
 return {result:row.result};
}
export async function configureFinanceAutomation(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=autoConfig.parse(input);await managerAccess(sql,actor,c.company_id,'finance.approve',platform);
 const [row]=await sql`SELECT bunyra_configure_finance_automation(${c.company_id}::uuid,${c.enabled}) AS enabled`;
 return {enabled:row.enabled};
}
export async function retryFinanceEvent(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=postEvent.parse(input);await managerAccess(sql,actor,c.company_id,'finance.approve',platform);
 const [row]=await sql`SELECT bunyra_retry_finance_event(${c.company_id}::uuid,${c.event_id}::uuid) AS event_id`;
 return {event_id:row.event_id};
}
export async function configureFinanceMapping(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=configuration.parse(input);
 await managerAccess(sql,actor,c.company_id,'finance.write',platform);
 if(c.cash_account_id===c.advance_account_id)throw new ServiceError('FINANCE_MAPPING_INVALID',422);
 const valid=(await sql`SELECT EXISTS(
   SELECT 1 FROM ledger_entities e JOIN ledger_journals j ON
    j.company_id=e.company_id AND j.entity_id=e.id AND j.id=${c.journal_id} AND j.active
   JOIN ledger_accounts cash ON cash.company_id=e.company_id AND cash.entity_id=e.id
    AND cash.id=${c.cash_account_id} AND cash.role IN('cash','bank') AND cash.kind='asset'
    AND ((cash.role='cash' AND j.kind='cash') OR (cash.role='bank' AND j.kind='bank'))
    AND cash.active AND cash.allow_posting
   JOIN ledger_accounts advances ON advances.company_id=e.company_id AND advances.entity_id=e.id
    AND advances.id=${c.advance_account_id} AND advances.role='customer_advance' AND advances.kind='liability'
    AND advances.active AND advances.allow_posting
   WHERE e.company_id=${c.company_id} AND e.id=${c.entity_id} AND e.is_default AND e.active
 ) AS valid`)[0];
 if(!valid?.valid)throw new ServiceError('FINANCE_MAPPING_INVALID',422);
 const results=await sql.transaction([sql`INSERT INTO finance_account_mappings(
  company_id,entity_id,journal_id,cash_account_id,advance_account_id,updated_by)
 VALUES(${c.company_id},${c.entity_id},${c.journal_id},${c.cash_account_id},${c.advance_account_id},${actor.userId})
 ON CONFLICT(company_id,entity_id) DO UPDATE SET journal_id=EXCLUDED.journal_id,
   cash_account_id=EXCLUDED.cash_account_id,advance_account_id=EXCLUDED.advance_account_id,
   updated_by=EXCLUDED.updated_by,updated_at=now()
 RETURNING company_id,entity_id,journal_id,cash_account_id,advance_account_id`,
 sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(${c.company_id},${actor.userId},${actor.email},'finance.mapping_configured',
   jsonb_build_object('entity_id',${c.entity_id}::text,'journal_id',${c.journal_id}::text))`]);
 return {mapping:results[0][0]};
}
export async function postFinanceEvent(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=postEvent.parse(input);await managerAccess(sql,actor,c.company_id,'finance.approve',platform);
 const posted=(await sql`SELECT bunyra_post_finance_event(${c.company_id}::uuid,${c.event_id}::uuid) AS entry_id`)[0];
 return {entry_id:posted.entry_id,state:'posted'};
}
