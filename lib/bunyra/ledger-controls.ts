import {z} from 'zod';
import {access,ServiceError,uuid,type Actor,type Sql} from './service';
const requireManager=async(sql:Sql,actor:Actor,company:string,action:'finance.read'|'finance.approve',asOwner:boolean)=>{
 const ctx=await access(sql,actor,company,action,asOwner);
 if(!ctx.owner&&!['company_admin','finance_manager'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
};
const period=z.object({company_id:uuid,entity_id:uuid,from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),reason:z.string().trim().min(3).max(500)}).strict();
const reversal=z.object({company_id:uuid,entry_id:uuid,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 reason:z.string().trim().min(3).max(500)}).strict();
export async function ledgerControlsOverview(sql:Sql,actor:Actor,company:string,asOwner=false){
 await requireManager(sql,actor,company,'finance.read',asOwner);
 const [periods,reversals]=await Promise.all([
  sql`SELECT id,entity_id,date_from,date_to,reason,locked_by,locked_at FROM ledger_period_locks
    WHERE company_id=${company} ORDER BY date_to DESC LIMIT 150`,
  sql`SELECT id,entity_id,original_entry_id,reversal_entry_id,reason,reversed_by,reversed_at
    FROM ledger_reversals WHERE company_id=${company} ORDER BY reversed_at DESC LIMIT 150`
 ]);
 return {periods,reversals};
}
export async function lockLedgerPeriod(sql:Sql,actor:Actor,input:unknown,asOwner=false){
 const p=period.parse(input);await requireManager(sql,actor,p.company_id,'finance.approve',asOwner);
 if(p.from>p.to)throw new ServiceError('INVALID_DATE_RANGE',400);
 const result=(await sql`SELECT bunyra_lock_ledger_period(${p.company_id}::uuid,${p.entity_id}::uuid,
   ${p.from}::date,${p.to}::date,${p.reason}::text) AS id`)[0];
 return {id:result.id,status:'locked'};
}
export async function reverseLedgerJournal(sql:Sql,actor:Actor,input:unknown,asOwner=false){
 const p=reversal.parse(input);await requireManager(sql,actor,p.company_id,'finance.approve',asOwner);
 const result=(await sql`SELECT bunyra_reverse_ledger_entry(${p.company_id}::uuid,
  ${p.entry_id}::uuid,${p.date}::date,${p.reason}::text) AS reversed_entry_id`)[0];
 return {reversed_entry_id:result.reversed_entry_id,status:'posted'};
}
