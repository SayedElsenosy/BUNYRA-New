import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {totalPayableMinor} from './payables-utils';
import {hasPermission} from './permissions';
async function manager(sql:Sql,actor:Actor,company:string,action:'finance.read'|'finance.write'|'finance.approve',platform:boolean){
 const c=await access(sql,actor,company,action,platform);
 if(!c.owner&&!['finance_manager','company_admin'].includes(c.role))throw new ServiceError('FORBIDDEN',403);
 return c;
}
const vendorInput=z.object({company_id:uuid,code:z.string().trim().min(2).max(40),name:z.string().trim().min(2).max(200),
 tax_registration:z.string().trim().max(50).default('')}).strict();
const lineInput=z.object({
 expense_account_id:uuid,project_id:uuid.nullable().default(null),
 cost_center_id:uuid.nullable().default(null),
 description:z.string().trim().min(1).max(500),
 amount_minor:z.string().regex(/^\d{1,18}$/)
}).strict();
const billInput=z.object({
 company_id:uuid,entity_id:uuid,vendor_id:uuid,
 invoice_number:z.string().trim().min(2).max(100),
 invoice_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 due_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 lines:z.array(lineInput).min(1).max(150)
}).strict();
const payableMapping=z.object({company_id:uuid,entity_id:uuid,journal_id:uuid,payable_account_id:uuid}).strict();
const billAction=z.object({company_id:uuid,bill_id:uuid}).strict();
export async function vendorPayablesOverview(sql:Sql,actor:Actor,company:string,platform=false){
 const ctx=await manager(sql,actor,company,'finance.read',platform);
 const [vendors,bills,mappings,payments,credits,refunds]=await Promise.all([
  sql`SELECT id,code,name,tax_registration,active,created_at
     FROM finance_vendors WHERE company_id=${company} ORDER BY code LIMIT 500`,
  sql`SELECT b.id,b.entity_id,b.vendor_id,b.invoice_number,b.invoice_date,b.due_date,b.total_minor::text,
    b.status,b.posted_entry_id,b.approved_at,
    balance.credited_minor::text,balance.net_total_minor::text,balance.paid_minor::text,balance.remaining_minor::text,balance.refundable_minor::text
    FROM finance_vendor_bills b JOIN finance_vendor_bill_balances balance
     ON balance.company_id=b.company_id AND balance.entity_id=b.entity_id AND balance.bill_id=b.id WHERE b.company_id=${company}
    ORDER BY b.created_at DESC LIMIT 300`,
  sql`SELECT company_id,entity_id,journal_id,payable_account_id FROM finance_payable_mappings
    WHERE company_id=${company}`,
  sql`SELECT p.id,p.bill_id,p.entity_id,p.journal_id,p.cash_account_id,p.paid_on,p.amount_minor::text,
    p.posted_entry_id,p.created_at,r.id AS reversal_id,r.posted_entry_id AS reversal_entry_id,r.reversed_on,r.reason AS reversal_reason,
    EXISTS(SELECT 1 FROM ledger_lines l JOIN treasury_bank_matches m ON m.company_id=l.company_id AND m.entity_id=l.entity_id AND m.ledger_line_id=l.id
      WHERE l.company_id=p.company_id AND l.entity_id=p.entity_id AND l.entry_id=p.posted_entry_id) AS reconciled
    FROM finance_vendor_payments p LEFT JOIN finance_vendor_payment_reversals r ON r.company_id=p.company_id AND r.entity_id=p.entity_id AND r.payment_id=p.id
    WHERE p.company_id=${company} ORDER BY p.created_at DESC LIMIT 500`,
  sql`SELECT c.id,c.entity_id,c.bill_id,b.invoice_number,c.reference,c.credit_date,c.reason,c.amount_minor::text,c.posted_entry_id,
    x.id AS reversal_id,x.posted_entry_id AS reversal_entry_id,x.reversed_on,x.reason AS reversal_reason,
    EXISTS(SELECT 1 FROM finance_active_vendor_refunds r WHERE r.company_id=c.company_id AND r.entity_id=c.entity_id AND r.credit_id=c.id) AS has_active_refunds,
    CASE WHEN x.id IS NOT NULL THEN '0' ELSE least(c.amount_minor-coalesce((SELECT sum(r.amount_minor) FROM finance_active_vendor_refunds r WHERE r.company_id=c.company_id AND r.entity_id=c.entity_id AND r.credit_id=c.id),0),balance.refundable_minor)::text END AS refundable_minor
   FROM finance_vendor_credits c JOIN finance_vendor_bill_balances balance ON balance.company_id=c.company_id AND balance.entity_id=c.entity_id AND balance.bill_id=c.bill_id
   JOIN finance_vendor_bills b ON b.company_id=c.company_id AND b.entity_id=c.entity_id AND b.id=c.bill_id
   LEFT JOIN finance_vendor_credit_reversals x ON x.company_id=c.company_id AND x.entity_id=c.entity_id AND x.credit_id=c.id
   WHERE c.company_id=${company} ORDER BY c.created_at DESC LIMIT 300`,
  sql`SELECT r.id,r.entity_id,r.bill_id,r.credit_id,r.payment_account_id,a.name AS payment_account_name,r.received_on,r.reference,r.amount_minor::text,r.posted_entry_id,
    x.id AS reversal_id,x.posted_entry_id AS reversal_entry_id,x.reversed_on,x.reason AS reversal_reason,
    EXISTS(SELECT 1 FROM ledger_lines l JOIN treasury_bank_matches m ON m.company_id=l.company_id AND m.entity_id=l.entity_id AND m.ledger_line_id=l.id
      WHERE l.company_id=r.company_id AND l.entity_id=r.entity_id AND l.entry_id=r.posted_entry_id) AS reconciled
   FROM finance_vendor_refunds r JOIN company_payment_accounts a ON a.company_id=r.company_id AND a.entity_id=r.entity_id AND a.id=r.payment_account_id
   LEFT JOIN finance_vendor_refund_reversals x ON x.company_id=r.company_id AND x.entity_id=r.entity_id AND x.refund_id=r.id
   WHERE r.company_id=${company} ORDER BY r.created_at DESC LIMIT 500`
 ]);
 return {vendors,bills,mappings,payments,credits,refunds,can_approve:ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'finance.approve'),implemented_scope:'vendor_bills_payments_and_corrections'};
}
export async function createFinanceVendor(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=vendorInput.parse(input);await manager(sql,actor,c.company_id,'finance.write',platform);
 const row=(await sql`INSERT INTO finance_vendors(company_id,code,name,tax_registration,created_by)
 VALUES(${c.company_id},${c.code},${c.name},${c.tax_registration},${actor.userId})
 RETURNING id,code,name,tax_registration`)[0];
 await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(${c.company_id},${actor.userId},${actor.email},'finance.vendor_created',jsonb_build_object('vendor_id',${row.id}::uuid))`;
 return {vendor:row};
}
export async function createVendorBill(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=billInput.parse(input);await manager(sql,actor,c.company_id,'finance.write',platform);
 if(c.invoice_date>c.due_date)throw new ServiceError('INVALID_DATE_RANGE',400);
 let total:string;
 try{total=totalPayableMinor(c.lines);}catch(e){throw new ServiceError((e as Error).message,422);}
 const id=crypto.randomUUID();
 const lines=c.lines.map((l,i)=>({...l,line_number:i+1}));
 const txn=await sql.transaction([
  sql`INSERT INTO finance_vendor_bills(id,company_id,entity_id,vendor_id,invoice_number,invoice_date,due_date,total_minor,created_by)
   VALUES(${id},${c.company_id},${c.entity_id},${c.vendor_id},${c.invoice_number},${c.invoice_date}::date,${c.due_date}::date,${total}::bigint,${actor.userId})
   RETURNING id,invoice_number,status,total_minor::text`,
  sql`INSERT INTO finance_vendor_bill_lines(company_id,entity_id,bill_id,line_number,
     expense_account_id,project_id,cost_center_id,description,amount_minor)
   SELECT ${c.company_id}::uuid,${c.entity_id}::uuid,${id}::uuid,
     x.line_number,x.expense_account_id,x.project_id,x.cost_center_id,x.description,x.amount_minor
   FROM jsonb_to_recordset(${JSON.stringify(lines)}::jsonb)
     AS x(line_number integer,expense_account_id uuid,project_id uuid,cost_center_id uuid,description text,amount_minor bigint)
   RETURNING id`,
  sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
   VALUES(${c.company_id},${actor.userId},${actor.email},'finance.vendor_bill_created',
      jsonb_build_object('bill_id',${id}::uuid,'vendor_id',${c.vendor_id}::uuid,'amount_minor',${total}::numeric))
   RETURNING id`
 ]);
 return {bill:txn[0][0],line_count:txn[1].length};
}
export async function approveVendorBill(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=billAction.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const row=(await sql`UPDATE finance_vendor_bills b
 SET status='approved',approved_by=${actor.userId},approved_at=now(),updated_at=now()
 WHERE b.company_id=${c.company_id} AND b.id=${c.bill_id} AND b.status='draft'
  AND b.total_minor=(SELECT coalesce(sum(l.amount_minor),0) FROM finance_vendor_bill_lines l
      WHERE l.company_id=b.company_id AND l.entity_id=b.entity_id AND l.bill_id=b.id)
 RETURNING b.id,b.status`)[0];
 if(!row)throw new ServiceError('VENDOR_BILL_NOT_APPROVABLE',409);
 await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(${c.company_id},${actor.userId},${actor.email},'finance.vendor_bill_approved',
  jsonb_build_object('bill_id',${c.bill_id}::uuid))`;
 return {bill:row};
}
export async function configurePayableMapping(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=payableMapping.parse(input);await manager(sql,actor,c.company_id,'finance.write',platform);
 const valid=(await sql`SELECT EXISTS(SELECT 1 FROM ledger_accounts a JOIN ledger_journals j
   ON j.company_id=a.company_id AND j.entity_id=a.entity_id AND j.id=${c.journal_id} AND j.active
   WHERE a.company_id=${c.company_id} AND a.entity_id=${c.entity_id} AND a.id=${c.payable_account_id}
     AND a.role='payable' AND a.active AND a.allow_posting) AS valid`)[0];
 if(!valid?.valid)throw new ServiceError('FINANCE_PAYABLE_MAPPING_INVALID',422);
 const row=(await sql`INSERT INTO finance_payable_mappings(company_id,entity_id,journal_id,payable_account_id,updated_by)
 VALUES(${c.company_id},${c.entity_id},${c.journal_id},${c.payable_account_id},${actor.userId})
 ON CONFLICT(company_id,entity_id) DO UPDATE SET journal_id=EXCLUDED.journal_id,
   payable_account_id=EXCLUDED.payable_account_id,updated_by=EXCLUDED.updated_by,updated_at=now()
 RETURNING company_id,entity_id,journal_id,payable_account_id`)[0];
 return {mapping:row};
}
export async function postVendorBill(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=billAction.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const row=(await sql`SELECT bunyra_post_vendor_bill(${c.company_id}::uuid,${c.bill_id}::uuid) AS entry_id`)[0];
 return {entry_id:row.entry_id,state:'posted'};
}

const vendorPaymentInput=z.object({
 company_id:uuid,bill_id:uuid,journal_id:uuid,cash_account_id:uuid,
 paid_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 amount_minor:z.string().regex(/^[1-9]\d{0,17}$/),
 idempotency_key:z.string().min(8).max(100)
}).strict();
export async function payVendorBill(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=vendorPaymentInput.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const row=(await sql`SELECT bunyra_pay_vendor_bill(
  ${c.company_id}::uuid,${c.bill_id}::uuid,${c.journal_id}::uuid,${c.cash_account_id}::uuid,
  ${c.paid_on}::date,${c.amount_minor}::bigint,${c.idempotency_key}::text) AS payment_id`)[0];
 return {payment_id:row.payment_id,status:'posted'};
}

const reversePaymentInput=z.object({company_id:uuid,payment_id:uuid,reversed_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),reason:z.string().trim().min(3).max(500)}).strict();
export async function reverseVendorPayment(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=reversePaymentInput.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const [row]=await sql`SELECT bunyra_reverse_vendor_payment(${c.company_id}::uuid,${c.payment_id}::uuid,${c.reversed_on}::date,${c.reason}) AS reversal_id`;
 return {reversal_id:row.reversal_id,status:'reversed'};
}

const creditInput=z.object({company_id:uuid,bill_id:uuid,reference:z.string().trim().min(2).max(100),credit_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),reason:z.string().trim().min(3).max(500),idempotency_key:z.string().min(8).max(100),
 lines:z.array(z.object({bill_line_id:uuid,amount_minor:z.string().regex(/^[1-9]\d{0,17}$/)}).strict()).min(1).max(150)}).strict();
export async function postVendorCredit(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=creditInput.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const [row]=await sql`SELECT bunyra_post_vendor_credit(${c.company_id}::uuid,${c.bill_id}::uuid,${c.reference},${c.credit_date}::date,${c.reason},${c.idempotency_key},${JSON.stringify(c.lines)}::jsonb) AS credit_id`;
 return {credit_id:row.credit_id,status:'posted'};
}
const refundInput=z.object({company_id:uuid,credit_id:uuid,payment_account_id:uuid,received_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),amount_minor:z.string().regex(/^[1-9]\d{0,17}$/),reference:z.string().trim().min(2).max(120),idempotency_key:z.string().min(8).max(100)}).strict();
export async function receiveVendorRefund(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=refundInput.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const [row]=await sql`SELECT bunyra_receive_vendor_refund(${c.company_id}::uuid,${c.credit_id}::uuid,${c.payment_account_id}::uuid,${c.received_on}::date,${c.amount_minor}::bigint,${c.reference},${c.idempotency_key}) AS refund_id`;
 return {refund_id:row.refund_id,status:'posted'};
}
export async function vendorCreditBillLines(sql:Sql,actor:Actor,company:string,billId:string,platform=false){
 uuid.parse(billId);await manager(sql,actor,company,'finance.read',platform);
 const rows=await sql`SELECT l.id,l.line_number,l.description,l.amount_minor::text,
   (l.amount_minor-coalesce((SELECT sum(c.amount_minor) FROM finance_vendor_credit_lines c WHERE c.company_id=l.company_id AND c.entity_id=l.entity_id AND c.bill_line_id=l.id
    AND NOT EXISTS(SELECT 1 FROM finance_vendor_credit_reversals x WHERE x.company_id=c.company_id AND x.entity_id=c.entity_id AND x.credit_id=c.credit_id)),0))::text AS remaining_minor
  FROM finance_vendor_bill_lines l JOIN finance_vendor_bills b ON b.company_id=l.company_id AND b.entity_id=l.entity_id AND b.id=l.bill_id
  WHERE l.company_id=${company} AND l.bill_id=${billId} AND b.status='posted' ORDER BY l.line_number LIMIT 150`;
 return {lines:rows};
}

const correctionFields={company_id:uuid,reversed_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),reason:z.string().trim().min(3).max(500)};
const reverseCreditInput=z.object({...correctionFields,credit_id:uuid}).strict();
export async function reverseVendorCredit(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=reverseCreditInput.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const [row]=await sql`SELECT bunyra_reverse_vendor_credit(${c.company_id}::uuid,${c.credit_id}::uuid,${c.reversed_on}::date,${c.reason}) AS reversal_id`;
 return {reversal_id:row.reversal_id,status:'reversed'};
}
const reverseRefundInput=z.object({...correctionFields,refund_id:uuid}).strict();
export async function reverseVendorRefund(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=reverseRefundInput.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const [row]=await sql`SELECT bunyra_reverse_vendor_refund(${c.company_id}::uuid,${c.refund_id}::uuid,${c.reversed_on}::date,${c.reason}) AS reversal_id`;
 return {reversal_id:row.reversal_id,status:'reversed'};
}
