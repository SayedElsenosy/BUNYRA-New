import {z} from 'zod';
import {access,ServiceError,uuid,type Actor,type Sql} from './service';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return v.slice(0,4)!=='0000'&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;});
const input=z.object({company_id:uuid,entity_id:uuid,vendor_id:uuid,from:date,to:date,page:z.coerce.number().int().min(1).max(100000).default(1)}).strict();
export type VendorStatementRow={entry_id:string;entry_date:string;reference:string;description:string;source_type:string;source_id:string|null;source_event:string;debit_minor:string;credit_minor:string;balance_minor:string};
export type VendorStatement={vendor:{id:string;code:string;name:string};entity:{id:string;code:string;name:string};from:string;to:string;currency:'EGP';page:number;page_size:number;total:number;opening_minor:string;debit_minor:string;credit_minor:string;closing_minor:string;rows:VendorStatementRow[]};
export async function vendorStatement(sql:Sql,actor:Actor,data:unknown,platform=false,exportAll=false):Promise<VendorStatement>{
 const c=input.parse(data);if(c.from>c.to)throw new ServiceError('INVALID_DATE_RANGE',400);
 const ctx=await access(sql,actor,c.company_id,'finance.read',platform);
 if(!ctx.owner&&!['company_admin','finance_manager'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
 const [vendors,entities]=await Promise.all([
  sql`SELECT id,code,name FROM finance_vendors WHERE company_id=${c.company_id} AND id=${c.vendor_id}`,
  sql`SELECT id,code,name FROM ledger_entities WHERE company_id=${c.company_id} AND id=${c.entity_id}`
 ]);
 if(!vendors[0]||!entities[0])throw new ServiceError('NOT_FOUND',404);
 // One snapshot supplies totals, pagination and running balances; no JS float arithmetic.
 const [result]=await sql`WITH movements AS(
  SELECT e.id AS entry_id,e.entry_date,e.reference,e.description,e.source_type,e.source_id,e.source_event,e.posted_at,
   sum(l.debit_minor::numeric) AS debit,sum(l.credit_minor::numeric) AS credit
  FROM ledger_lines l JOIN ledger_entries e ON e.company_id=l.company_id AND e.entity_id=l.entity_id AND e.id=l.entry_id
  JOIN ledger_accounts a ON a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
  WHERE l.company_id=${c.company_id} AND l.entity_id=${c.entity_id} AND l.vendor_id=${c.vendor_id}
   AND a.role='payable' AND e.state='posted' AND e.entry_date<=${c.to}::date
  GROUP BY e.id,e.entry_date,e.reference,e.description,e.source_type,e.source_id,e.source_event,e.posted_at
 ), opening AS(SELECT coalesce(sum(credit-debit),0) AS amount FROM movements WHERE entry_date<${c.from}::date),
 period AS(SELECT * FROM movements WHERE entry_date>=${c.from}::date),
 summary AS(SELECT count(*)::int AS total,coalesce(sum(debit),0) AS debit,coalesce(sum(credit),0) AS credit FROM period),
 running AS(SELECT *, (SELECT amount FROM opening)+sum(credit-debit) OVER(ORDER BY entry_date,posted_at,entry_id ROWS UNBOUNDED PRECEDING) AS balance FROM period),
 page AS(SELECT * FROM running ORDER BY entry_date,posted_at,entry_id LIMIT ${exportAll?10001:50} OFFSET ${exportAll?0:(c.page-1)*50})
 SELECT summary.total,opening.amount::text AS opening_minor,summary.debit::text AS debit_minor,summary.credit::text AS credit_minor,
  (opening.amount+summary.credit-summary.debit)::text AS closing_minor,
  coalesce((SELECT jsonb_agg(jsonb_build_object('entry_id',entry_id,'entry_date',entry_date,'reference',reference,'description',description,
   'source_type',source_type,'source_id',source_id,'source_event',source_event,'debit_minor',debit::text,'credit_minor',credit::text,'balance_minor',balance::text)
   ORDER BY entry_date,posted_at,entry_id) FROM page),'[]'::jsonb) AS rows
 FROM summary CROSS JOIN opening`;
 if(exportAll&&result.total>10000)throw new ServiceError('STATEMENT_EXPORT_LIMIT',422);
 return {vendor:vendors[0] as VendorStatement['vendor'],entity:entities[0] as VendorStatement['entity'],from:c.from,to:c.to,currency:'EGP',page:exportAll?1:c.page,page_size:exportAll?10000:50,...result} as VendorStatement;
}
