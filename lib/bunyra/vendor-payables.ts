import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {totalPayableMinor} from './payables-utils';
async function manager(sql:Sql,actor:Actor,company:string,action:'finance.read'|'finance.write'|'finance.approve',platform:boolean){
 const c=await access(sql,actor,company,action,platform);
 if(!c.owner&&!['finance_manager','company_admin'].includes(c.role))throw new ServiceError('FORBIDDEN',403);
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
 await manager(sql,actor,company,'finance.read',platform);
 const [vendors,bills,mappings]=await Promise.all([
  sql`SELECT id,code,name,tax_registration,active,created_at
     FROM finance_vendors WHERE company_id=${company} ORDER BY code LIMIT 500`,
  sql`SELECT id,entity_id,vendor_id,invoice_number,invoice_date,due_date,total_minor::text,
    status,posted_entry_id,approved_at FROM finance_vendor_bills WHERE company_id=${company}
    ORDER BY created_at DESC LIMIT 300`,
  sql`SELECT company_id,entity_id,journal_id,payable_account_id FROM finance_payable_mappings
    WHERE company_id=${company}`
 ]);
 return {vendors,bills,mappings,implemented_scope:'vendor_bills_and_gl_posting'};
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
