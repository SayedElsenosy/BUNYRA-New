import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return v.slice(0,4)!=='0000'&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;});
const input=z.object({company_id:uuid,entity_id:uuid,vendor_id:uuid.nullable().default(null),as_of:date,page:z.coerce.number().int().min(1).max(100000).default(1)}).strict();
export const AGING_BUCKETS=['current','days_1_30','days_31_60','days_61_90','days_91_plus'] as const;
export type AgingBucket=typeof AGING_BUCKETS[number];
export type VendorAgingRow={bill_id:string;vendor_id:string;vendor_code:string;vendor_name:string;invoice_number:string;invoice_date:string;due_date:string;days_overdue:number;total_minor:string;credited_minor:string;paid_minor:string;refunded_minor:string;balance_minor:string;due_minor:string;receivable_minor:string;bucket:AgingBucket};
export type VendorAging={entity:{id:string;code:string;name:string};vendor:{id:string;code:string;name:string}|null;as_of:string;currency:'EGP';page:number;page_size:number;total:number;due_minor:string;receivable_minor:string;net_minor:string;ledger_minor:string;unallocated_minor:string;buckets:Record<AgingBucket,string>;rows:VendorAgingRow[]};
export async function vendorAging(sql:Sql,actor:Actor,data:unknown,platform=false,exportAll=false):Promise<VendorAging>{
 const c=input.parse(data),ctx=await access(sql,actor,c.company_id,'finance.read',platform);
 if(!ctx.owner&&!['company_admin','finance_manager'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
 const [entities,vendors]=await Promise.all([sql`SELECT id,code,name FROM ledger_entities WHERE company_id=${c.company_id} AND id=${c.entity_id}`,
  c.vendor_id?sql`SELECT id,code,name FROM finance_vendors WHERE company_id=${c.company_id} AND id=${c.vendor_id}`:Promise.resolve([])]);
 if(!entities[0]||(c.vendor_id&&!vendors[0]))throw new ServiceError('NOT_FOUND',404);
 // Historical balances use accounting dates, never today's active-document views.
 const [result]=await sql`WITH source AS(
  SELECT b.id AS bill_id,b.vendor_id,v.code AS vendor_code,v.name AS vendor_name,b.invoice_number,b.invoice_date,b.due_date,b.total_minor::numeric,
   coalesce(cr.amount,0) AS credited,coalesce(pa.amount,0) AS paid,coalesce(re.amount,0) AS refunded,
   greatest(${c.as_of}::date-b.due_date,0) AS days_overdue
  FROM finance_vendor_bills b JOIN finance_vendors v ON v.company_id=b.company_id AND v.id=b.vendor_id
  JOIN ledger_entries e ON e.company_id=b.company_id AND e.entity_id=b.entity_id AND e.id=b.posted_entry_id AND e.state='posted' AND e.entry_date<=${c.as_of}::date
  LEFT JOIN LATERAL(SELECT sum(d.amount_minor::numeric) AS amount FROM finance_vendor_credits d
   WHERE d.company_id=b.company_id AND d.entity_id=b.entity_id AND d.bill_id=b.id AND d.credit_date<=${c.as_of}::date
   AND NOT EXISTS(SELECT 1 FROM finance_vendor_credit_reversals x WHERE x.company_id=d.company_id AND x.entity_id=d.entity_id AND x.credit_id=d.id AND x.reversed_on<=${c.as_of}::date)) cr ON true
  LEFT JOIN LATERAL(SELECT sum(d.amount_minor::numeric) AS amount FROM finance_vendor_payments d
   WHERE d.company_id=b.company_id AND d.entity_id=b.entity_id AND d.bill_id=b.id AND d.paid_on<=${c.as_of}::date
   AND NOT EXISTS(SELECT 1 FROM finance_vendor_payment_reversals x WHERE x.company_id=d.company_id AND x.entity_id=d.entity_id AND x.payment_id=d.id AND x.reversed_on<=${c.as_of}::date)) pa ON true
  LEFT JOIN LATERAL(SELECT sum(d.amount_minor::numeric) AS amount FROM finance_vendor_refunds d
   WHERE d.company_id=b.company_id AND d.entity_id=b.entity_id AND d.bill_id=b.id AND d.received_on<=${c.as_of}::date
   AND NOT EXISTS(SELECT 1 FROM finance_vendor_refund_reversals x WHERE x.company_id=d.company_id AND x.entity_id=d.entity_id AND x.refund_id=d.id AND x.reversed_on<=${c.as_of}::date)) re ON true
  WHERE b.company_id=${c.company_id} AND b.entity_id=${c.entity_id} AND b.status='posted' AND b.invoice_date<=${c.as_of}::date
   AND (${c.vendor_id}::uuid IS NULL OR b.vendor_id=${c.vendor_id}::uuid)
 ), balances AS(SELECT *,total_minor-credited-paid+refunded AS balance,
  CASE WHEN days_overdue=0 THEN 'current' WHEN days_overdue<=30 THEN 'days_1_30' WHEN days_overdue<=60 THEN 'days_31_60' WHEN days_overdue<=90 THEN 'days_61_90' ELSE 'days_91_plus' END AS bucket FROM source),
 open_bills AS(SELECT *,greatest(balance,0) AS due,greatest(-balance,0) AS receivable FROM balances WHERE balance<>0),
 totals AS(SELECT count(*)::int AS total,coalesce(sum(due),0) AS due,coalesce(sum(receivable),0) AS receivable,
  coalesce(sum(due) FILTER(WHERE bucket='current'),0) AS current,
  coalesce(sum(due) FILTER(WHERE bucket='days_1_30'),0) AS days_1_30,
  coalesce(sum(due) FILTER(WHERE bucket='days_31_60'),0) AS days_31_60,
  coalesce(sum(due) FILTER(WHERE bucket='days_61_90'),0) AS days_61_90,
  coalesce(sum(due) FILTER(WHERE bucket='days_91_plus'),0) AS days_91_plus FROM open_bills),
 gl AS(SELECT coalesce(sum(l.credit_minor::numeric-l.debit_minor::numeric),0) AS amount FROM ledger_lines l
  JOIN ledger_entries e ON e.company_id=l.company_id AND e.entity_id=l.entity_id AND e.id=l.entry_id
  JOIN ledger_accounts a ON a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
  WHERE l.company_id=${c.company_id} AND l.entity_id=${c.entity_id} AND a.role='payable' AND e.state='posted' AND e.entry_date<=${c.as_of}::date
   AND (${c.vendor_id}::uuid IS NULL OR l.vendor_id=${c.vendor_id}::uuid)),
 page AS(SELECT * FROM open_bills ORDER BY due_date,bill_id LIMIT ${exportAll?10001:50} OFFSET ${exportAll?0:(c.page-1)*50})
 SELECT total,due::text AS due_minor,receivable::text AS receivable_minor,(due-receivable)::text AS net_minor,
  gl.amount::text AS ledger_minor,(gl.amount-due+receivable)::text AS unallocated_minor,
  jsonb_build_object('current',current::text,'days_1_30',days_1_30::text,'days_31_60',days_31_60::text,'days_61_90',days_61_90::text,'days_91_plus',days_91_plus::text) AS buckets,
  coalesce((SELECT jsonb_agg(jsonb_build_object('bill_id',bill_id,'vendor_id',vendor_id,'vendor_code',vendor_code,'vendor_name',vendor_name,
   'invoice_number',invoice_number,'invoice_date',invoice_date,'due_date',due_date,'days_overdue',days_overdue,'total_minor',total_minor::text,
   'credited_minor',credited::text,'paid_minor',paid::text,'refunded_minor',refunded::text,'balance_minor',balance::text,'due_minor',due::text,'receivable_minor',receivable::text,'bucket',bucket)
   ORDER BY due_date,bill_id) FROM page),'[]'::jsonb) AS rows FROM totals CROSS JOIN gl`;
 if(exportAll&&result.total>10000)throw new ServiceError('AGING_EXPORT_LIMIT',422);
 return {entity:entities[0],vendor:vendors[0]||null,as_of:c.as_of,currency:'EGP',page:exportAll?1:c.page,page_size:exportAll?10000:50,...result} as VendorAging;
}
