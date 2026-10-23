import {z} from 'zod';
import {access,ServiceError,uuid,type Actor,type Sql} from './service';

export const paymentFields={payment_account_id:uuid.optional(),exchange_rate:z.string().regex(/^\d{1,10}(\.\d{1,8})?$/).optional()};
const schema=z.object({company_id:uuid,entity_id:uuid,code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,12}$/),
 name:z.string().trim().min(2).max(160),kind:z.enum(['cash','bank']),
 currency_code:z.enum(['EGP','USD','EUR','GBP','SAR','AED','QAR','CHF','CAD','AUD','CNY'])}).strict();
export async function createPaymentAccount(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=schema.parse(input),ctx=await access(sql,actor,c.company_id,'finance.approve',platform);
 if(!ctx.owner&&!['company_admin','finance_manager'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
 const [row]=await sql`SELECT bunyra_create_payment_account(${c.company_id}::uuid,${c.entity_id}::uuid,
  ${c.code},${c.name},${c.kind},${c.currency_code}) AS id`;
 return row;
}
// This list is also used by scoped accountants when recording a receipt.
export async function listPaymentAccounts(sql:Sql,company:string){
 return sql`SELECT p.id,p.entity_id,p.code,p.name,p.kind,p.currency_code,p.account_id,p.journal_id,p.active
  FROM company_payment_accounts p JOIN ledger_accounts a ON a.company_id=p.company_id AND a.entity_id=p.entity_id AND a.id=p.account_id
  JOIN ledger_journals j ON j.company_id=p.company_id AND j.entity_id=p.entity_id AND j.id=p.journal_id
  WHERE p.company_id=${company} AND p.active AND a.active AND a.allow_posting AND j.active ORDER BY p.name,p.code`;
}
