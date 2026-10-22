import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {validateLedgerBalance} from './ledger-utils';

// The opening GL phase restricts full-ledger access to finance managers,
// company admins and the platform owner. Scoped accountants are added later.
async function managerAccess(sql:Sql,actor:Actor,company:string,action:'finance.read'|'finance.write'|'finance.approve',platform:boolean){
 const ctx=await access(sql,actor,company,action,platform);
 if(!ctx.owner&&!['company_admin','finance_manager'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
}
const base=z.object({company_id:uuid,entity_id:uuid});
const templateSchema=base.extend({language:z.enum(['ar','en'])}).strict();
export async function initializeAccounting(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=templateSchema.parse(input);await managerAccess(sql,actor,c.company_id,'finance.approve',platform);
 const [row]=await sql`SELECT bunyra_initialize_accounting(${c.company_id}::uuid,${c.entity_id}::uuid,${c.language}) AS result`;
 return {setup:row.result};
}
const accountSchema=base.extend({
 code:z.string().trim().min(2).max(30),name:z.string().trim().min(2).max(160),
 kind:z.enum(['asset','liability','equity','income','expense']),
 role:z.enum(['general','receivable','payable','cash','bank','customer_advance','tax','clearing']).default('general'),
 reconcilable:z.boolean().default(false)
}).strict();
const journalSchema=base.extend({
 code:z.string().trim().min(2).max(15),name:z.string().trim().min(2).max(160),
 kind:z.enum(['general','sales','purchase','cash','bank','payroll','adjustment'])
}).strict();
const centerSchema=base.extend({project_id:uuid.nullable().default(null),
 code:z.string().trim().min(2).max(30),name:z.string().trim().min(2).max(160)}).strict();
const lineSchema=z.object({
 account_id:uuid,project_id:uuid.nullable().default(null),
 cost_center_id:uuid.nullable().default(null),customer_id:uuid.nullable().default(null),
 contract_id:uuid.nullable().default(null),description:z.string().max(500).default(''),
 debit_minor:z.string().regex(/^\d{1,18}$/),credit_minor:z.string().regex(/^\d{1,18}$/)
}).strict();
const draftSchema=base.extend({
 journal_id:uuid,entry_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 reference:z.string().trim().min(1).max(200),description:z.string().max(1000).default(''),
 idempotency_key:z.string().trim().min(8).max(128),
 lines:z.array(lineSchema).min(2).max(200)
}).strict();
async function hash(data:unknown){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))));
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
export async function ledgerOverview(sql:Sql,actor:Actor,company:string,platform=false){
 await managerAccess(sql,actor,company,'finance.read',platform);
 const [entities,accounts,journals,centers,entries,projects]=await Promise.all([
  sql`SELECT id,code,name,is_default,active FROM ledger_entities WHERE company_id=${company} ORDER BY is_default DESC,code`,
  sql`SELECT a.id,a.entity_id,a.code,a.name,a.kind,a.role,a.reconcilable,a.active,
    COALESCE((SELECT p.currency_code FROM company_payment_accounts p WHERE p.company_id=a.company_id AND p.account_id=a.id),'EGP') AS currency_code
    FROM ledger_accounts a WHERE a.company_id=${company} ORDER BY a.code LIMIT 1500`,
  sql`SELECT id,entity_id,code,name,kind,active FROM ledger_journals WHERE company_id=${company} ORDER BY code LIMIT 500`,
  sql`SELECT id,entity_id,project_id,code,name,active FROM ledger_cost_centers WHERE company_id=${company} ORDER BY code LIMIT 1000`,
  sql`SELECT id,entity_id,journal_id,entry_date,reference,description,state,source_type,source_id,posted_at FROM ledger_entries WHERE company_id=${company} ORDER BY entry_date DESC,created_at DESC LIMIT 100`,
  sql`SELECT id,name FROM projects WHERE company_id=${company} ORDER BY name`
 ]);
 return {entities,accounts,journals,centers,entries,projects};
}
export async function ledgerCreateAccount(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=accountSchema.parse(input);await managerAccess(sql,actor,c.company_id,'finance.write',platform);
 const r=await sql`INSERT INTO ledger_accounts(company_id,entity_id,code,name,kind,role,reconcilable)
 VALUES(${c.company_id},${c.entity_id},${c.code},${c.name},${c.kind},${c.role},${c.reconcilable})
 RETURNING id,entity_id,code,name,kind,role`;
 return {account:r[0]};
}
export async function ledgerCreateJournal(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=journalSchema.parse(input);await managerAccess(sql,actor,c.company_id,'finance.write',platform);
 const r=await sql`INSERT INTO ledger_journals(company_id,entity_id,code,name,kind)
 VALUES(${c.company_id},${c.entity_id},${c.code},${c.name},${c.kind}) RETURNING id,entity_id,code,name,kind`;
 return {journal:r[0]};
}
export async function ledgerCreateCostCenter(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=centerSchema.parse(input);await managerAccess(sql,actor,c.company_id,'finance.write',platform);
 const r=await sql`INSERT INTO ledger_cost_centers(company_id,entity_id,project_id,code,name)
 VALUES(${c.company_id},${c.entity_id},${c.project_id},${c.code},${c.name}) RETURNING id,entity_id,project_id,code,name`;
 return {center:r[0]};
}
export async function ledgerCreateDraft(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=draftSchema.parse(input);await managerAccess(sql,actor,c.company_id,'finance.write',platform);
 try{validateLedgerBalance(c.lines);}catch(e){throw new ServiceError((e as Error).message,422);}
 // Manual-only endpoint. Commercial source events must be minted by trusted adapters.
 const payloadHash=await hash({company_id:c.company_id,entity_id:c.entity_id,journal_id:c.journal_id,
  entry_date:c.entry_date,reference:c.reference,description:c.description,lines:c.lines});
 const id=crypto.randomUUID();
 const lines=c.lines.map((line,i)=>({...line,line_number:i+1}));
 const tx=await sql.transaction([
  sql`INSERT INTO ledger_entries(id,company_id,entity_id,journal_id,entry_date,reference,description,idempotency_key,payload_hash,created_by)
      VALUES(${id},${c.company_id},${c.entity_id},${c.journal_id},${c.entry_date}::date,${c.reference},${c.description},${c.idempotency_key},${payloadHash},${actor.userId})
      ON CONFLICT(company_id,entity_id,idempotency_key) DO NOTHING RETURNING id`,
  sql`INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,project_id,cost_center_id,customer_id,contract_id,description,debit_minor,credit_minor)
      SELECT ${c.company_id}::uuid,${c.entity_id}::uuid,${id}::uuid,
       x.line_number,x.account_id,x.project_id,x.cost_center_id,x.customer_id,x.contract_id,x.description,x.debit_minor,x.credit_minor
      FROM jsonb_to_recordset(${JSON.stringify(lines)}::jsonb)
      AS x(line_number integer,account_id uuid,project_id uuid,cost_center_id uuid,customer_id uuid,contract_id uuid,description text,debit_minor bigint,credit_minor bigint)
      WHERE EXISTS(SELECT 1 FROM ledger_entries WHERE company_id=${c.company_id} AND entity_id=${c.entity_id} AND id=${id})
      RETURNING id`
 ]);
 if(tx[0].length)return {id,state:'draft',created:true};
 const existing=(await sql`SELECT id,payload_hash,state FROM ledger_entries WHERE company_id=${c.company_id} AND entity_id=${c.entity_id} AND idempotency_key=${c.idempotency_key}`)[0];
 if(!existing||existing.payload_hash!==payloadHash)throw new ServiceError('LEDGER_IDEMPOTENCY_CONFLICT',409);
 return {id:existing.id,state:existing.state,created:false};
}
export async function ledgerPost(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=z.object({company_id:uuid,id:uuid}).strict().parse(input);
 await managerAccess(sql,actor,c.company_id,'finance.approve',platform);
 const r=await sql`SELECT bunyra_ledger_post_entry(${c.company_id}::uuid,${c.id}::uuid) AS id`;
 return {id:r[0]?.id,state:'posted'};
}
