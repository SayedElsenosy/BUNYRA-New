import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {requireContract,projectAllowed} from './record-scope';
import {minorUnits} from './projects';
import {recordCollection} from './commercial';

const issueSchema=z.object({
 company_id:uuid,contract_id:uuid,installment_id:uuid,
 amount:z.string().regex(/^\d{1,14}(\.\d{1,2})?$/),
 reference:z.string().trim().min(3).max(120),
}).strict();
const bounceSchema=z.object({
 company_id:uuid,receipt_id:uuid,reason:z.string().trim().min(3).max(500)
}).strict();
const clearSchema=z.object({
 company_id:uuid,receipt_id:uuid,payment_account_id:uuid,
 exchange_rate:z.string().regex(/^\d{1,10}(\.\d{1,8})?$/).optional()
}).strict();

async function financeAccess(sql:Sql,actor:Actor,company:string,action:'finance.read'|'finance.write',platform=false) {
 const ctx=await access(sql,actor,company,action,platform);
 if(!ctx.owner&&!['company_admin','finance_manager','accountant'].includes(ctx.role))
  throw new ServiceError('FORBIDDEN',403);
 return ctx;
}

export async function getCompanyCheques(sql:Sql,actor:Actor,company:string,platform=false) {
 const ctx=await financeAccess(sql,actor,company,'finance.read',platform);
 const rows=await sql`SELECT r.id,r.contract_id,r.installment_id,r.amount_minor::text,
   r.reference_number,r.created_at,r.cheque_state,r.resolved_at,
   c.project_id,c.contract_number,b.customer_name,COALESCE(c.payment_plan_snapshot->'book'->>'currency','EGP') AS currency_code
  FROM receipt_status r JOIN contracts c ON c.company_id=r.company_id AND c.id=r.contract_id
  JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
  WHERE r.company_id=${company}::uuid AND r.method='CHEQUE'
  ORDER BY r.created_at DESC LIMIT 100`;
 return {cheques:rows.filter(x=>projectAllowed(ctx,'finance.read',x.project_id))};
}
export async function issuePendingCheque(sql:Sql,actor:Actor,input:unknown,platform=false) {
 const c=issueSchema.parse(input);
 await financeAccess(sql,actor,c.company_id,'finance.write',platform);
 const contract=await requireContract(sql,actor,c.company_id,c.contract_id,'finance.write',platform);
 if(contract.status!=='active')throw new ServiceError('CONTRACT_NOT_ACTIVE',409);
 const minor=minorUnits(c.amount).toString();
 if(BigInt(minor)<=BigInt(0))throw new ServiceError('INVALID_AMOUNT',400);
 const result=await sql.transaction([
  sql`SELECT id FROM contracts WHERE company_id=${c.company_id}::uuid AND id=${c.contract_id}::uuid AND status='active' FOR UPDATE`,
  sql`SELECT bunyra_pricing_assert(EXISTS(
    SELECT 1 FROM contract_installments i WHERE i.company_id=${c.company_id}::uuid
      AND i.contract_id=${c.contract_id}::uuid AND i.id=${c.installment_id}::uuid
      AND i.amount_minor-i.paid_minor-COALESCE((
        SELECT SUM(p.amount_minor) FROM receipts p WHERE p.company_id=i.company_id
         AND p.contract_id=i.contract_id AND p.installment_id=i.id AND p.method='CHEQUE'
         AND p.initial_state='PENDING' AND NOT EXISTS(
           SELECT 1 FROM receipt_cheque_events e WHERE e.company_id=p.company_id AND e.receipt_id=p.id)
      ),0)>=${minor}::bigint
  ),'CHEQUE_EXCEEDS_REMAINING')`,
  sql`INSERT INTO receipts(company_id,contract_id,installment_id,amount_minor,method,reference_number,initial_state,created_by)
    VALUES(${c.company_id}::uuid,${c.contract_id}::uuid,${c.installment_id}::uuid,
       ${minor}::bigint,'CHEQUE',${c.reference},'PENDING',${actor.userId})
    RETURNING id,initial_state,amount_minor::text`,
  sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
    VALUES(${c.company_id}::uuid,${actor.userId},${actor.email},'receipt.cheque_issued',
      jsonb_build_object('contract_id',${c.contract_id}::text,'reference',${c.reference}))`
 ]);
 return {receipt:result[2][0]};
}
export async function bouncePendingCheque(sql:Sql,actor:Actor,input:unknown,platform=false) {
 const c=bounceSchema.parse(input);
 await financeAccess(sql,actor,c.company_id,'finance.write',platform);
 const receipt=(await sql`SELECT r.id,r.contract_id,r.initial_state,r.method,r.cheque_state
  FROM receipt_status r WHERE r.company_id=${c.company_id}::uuid AND r.id=${c.receipt_id}::uuid`)[0];
 if(!receipt||receipt.method!=='CHEQUE'||receipt.cheque_state!=='PENDING')
  throw new ServiceError('CHEQUE_NOT_PENDING',409);
 await requireContract(sql,actor,c.company_id,receipt.contract_id,'finance.write',platform);
 const results=await sql.transaction([
  sql`INSERT INTO receipt_cheque_events(company_id,receipt_id,new_state,reason,recorded_by)
    VALUES(${c.company_id}::uuid,${c.receipt_id}::uuid,'BOUNCED',${c.reason},${actor.userId})
    RETURNING id,new_state`,
  sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
    VALUES(${c.company_id}::uuid,${actor.userId},${actor.email},'receipt.cheque_bounced',
      jsonb_build_object('receipt_id',${c.receipt_id}::text,'reason',${c.reason}))`
 ]);
 return {event:results[0][0]};
}
export async function clearPendingCheque(sql:Sql,actor:Actor,input:unknown,platform=false) {
 const c=clearSchema.parse(input);
 await financeAccess(sql,actor,c.company_id,'finance.write',platform);
 const receipt=(await sql`SELECT r.id,r.contract_id,r.installment_id,r.amount_minor::text,
   r.reference_number,r.cheque_state
  FROM receipt_status r WHERE r.company_id=${c.company_id}::uuid AND r.id=${c.receipt_id}::uuid AND r.method='CHEQUE'`)[0];
 if(!receipt||receipt.cheque_state!=='PENDING')
  throw new ServiceError('CHEQUE_NOT_PENDING',409);
 await requireContract(sql,actor,c.company_id,receipt.contract_id,'finance.write',platform);
 const amountMinor=BigInt(receipt.amount_minor);
 const amount=(amountMinor/BigInt(100)).toString()+'.'+(amountMinor%BigInt(100)).toString().padStart(2,'0');
 const posted=await recordCollection(sql,actor,{
   company_id:c.company_id,contract_id:receipt.contract_id,
   installment_id:receipt.installment_id,amount,reference:receipt.reference_number,
   payment_account_id:c.payment_account_id,exchange_rate:c.exchange_rate,
   cheque_receipt_id:c.receipt_id
 },platform);
 return posted;
}
