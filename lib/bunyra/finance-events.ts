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
 const [events,mappings]=await Promise.all([
  sql`SELECT id,source_kind,source_id,event_type,processing_kind,status,
     project_id,customer_id,contract_id,amount_minor::text,event_at,
     ledger_entry_id,created_at FROM finance_events
     WHERE company_id=${company} ORDER BY created_at DESC,id DESC LIMIT 300`,
  sql`SELECT company_id,entity_id,journal_id,cash_account_id,advance_account_id,updated_at
     FROM finance_account_mappings WHERE company_id=${company}`
 ]);
 return {events,mappings,posting_scope:'cash_and_customer_advances_only',
   informational_events_do_not_create_journal_entries:true};
}
export async function configureFinanceMapping(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=configuration.parse(input);
 await managerAccess(sql,actor,c.company_id,'finance.write',platform);
 if(c.cash_account_id===c.advance_account_id)throw new ServiceError('FINANCE_MAPPING_INVALID',422);
 const valid=(await sql`SELECT EXISTS(
   SELECT 1 FROM ledger_entities e JOIN ledger_journals j ON
    j.company_id=e.company_id AND j.entity_id=e.id AND j.id=${c.journal_id} AND j.active
   JOIN ledger_accounts cash ON cash.company_id=e.company_id AND cash.entity_id=e.id
    AND cash.id=${c.cash_account_id} AND cash.role IN('cash','bank')
    AND cash.active AND cash.allow_posting
   JOIN ledger_accounts advances ON advances.company_id=e.company_id AND advances.entity_id=e.id
    AND advances.id=${c.advance_account_id} AND advances.role='customer_advance'
    AND advances.active AND advances.allow_posting
   WHERE e.company_id=${c.company_id} AND e.id=${c.entity_id} AND e.is_default AND e.active
 ) AS valid`)[0];
 if(!valid?.valid)throw new ServiceError('FINANCE_MAPPING_INVALID',422);
 const row=(await sql`INSERT INTO finance_account_mappings(
  company_id,entity_id,journal_id,cash_account_id,advance_account_id,updated_by)
 VALUES(${c.company_id},${c.entity_id},${c.journal_id},${c.cash_account_id},${c.advance_account_id},${actor.userId})
 ON CONFLICT(company_id,entity_id) DO UPDATE SET journal_id=EXCLUDED.journal_id,
   cash_account_id=EXCLUDED.cash_account_id,advance_account_id=EXCLUDED.advance_account_id,
   updated_by=EXCLUDED.updated_by,updated_at=now()
 RETURNING company_id,entity_id,journal_id,cash_account_id,advance_account_id`)[0];
 await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(${c.company_id},${actor.userId},${actor.email},'finance.mapping_configured',
   jsonb_build_object('entity_id',${c.entity_id}::text,'journal_id',${c.journal_id}::text))`;
 return {mapping:row};
}
export async function postFinanceEvent(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=postEvent.parse(input);await managerAccess(sql,actor,c.company_id,'finance.approve',platform);
 const posted=(await sql`SELECT bunyra_post_finance_event(${c.company_id}::uuid,${c.event_id}::uuid) AS entry_id`)[0];
 return {entry_id:posted.entry_id,state:'posted'};
}
