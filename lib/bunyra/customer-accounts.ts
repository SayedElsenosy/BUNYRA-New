import {z} from 'zod';
import {access,ServiceError,uuid,type Actor,type Sql} from './service';

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !v.startsWith('0000')&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;});
const base=z.object({company_id:uuid,entity_id:uuid,customer_id:uuid.nullable().default(null),page:z.coerce.number().int().min(1).max(100000).default(1)});
async function authorize(sql:Sql,actor:Actor,company:string,platform:boolean){
 const ctx=await access(sql,actor,company,'finance.read',platform);
 if(!ctx.owner&&!['company_admin','finance_manager'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
}
async function dimensions(sql:Sql,actor:Actor,c:{company_id:string;entity_id:string;customer_id:string|null},platform:boolean){
 await authorize(sql,actor,c.company_id,platform);
 const [entities,customers]=await Promise.all([
  sql`SELECT id,code,name,is_default FROM ledger_entities WHERE company_id=${c.company_id} AND id=${c.entity_id}`,
  c.customer_id?sql`SELECT id,full_name FROM crm_customers WHERE company_id=${c.company_id} AND id=${c.customer_id}`:Promise.resolve([])
 ]);
 if(!entities[0]||(c.customer_id&&!customers[0]))throw new ServiceError('NOT_FOUND',404);
 return {entity:entities[0],customer:customers[0]||null};
}
export async function customerAccountChoices(sql:Sql,actor:Actor,data:unknown,platform=false){
 const c=z.object({company_id:uuid,q:z.string().trim().max(100).default('')}).strict().parse(data);
 await authorize(sql,actor,c.company_id,platform);
 // A bounded search, not the CRM directory's sales-assignment permissions.
 const rows=await sql`SELECT id,full_name FROM crm_customers WHERE company_id=${c.company_id}
  AND (${c.q}='' OR position(lower(${c.q}) in lower(full_name))>0 OR position(${c.q} in phone)>0)
  ORDER BY full_name,id LIMIT 51`;
 return {rows:rows.slice(0,50),has_more:rows.length>50};
}
export type CustomerStatementRow={entry_id:string;account_id:string;account_code:string;account_name:string;account_role:'receivable'|'customer_advance';entry_date:string;reference:string;description:string;source_type:string;source_id:string|null;source_event:string;debit_minor:string;credit_minor:string;balance_minor:string};
export type CustomerStatement={entity:{id:string;code:string;name:string};customer:{id:string;full_name:string};from:string;to:string;currency:'EGP';page:number;page_size:number;total:number;opening_minor:string;debit_minor:string;credit_minor:string;closing_minor:string;receivable_minor:string;advance_minor:string;rows:CustomerStatementRow[]};
export async function customerStatement(sql:Sql,actor:Actor,data:unknown,platform=false,exportAll=false):Promise<CustomerStatement>{
 const c=base.extend({customer_id:uuid,from:date,to:date}).strict().parse(data);
 if(c.from>c.to)throw new ServiceError('INVALID_DATE_RANGE',400);
 const dims=await dimensions(sql,actor,c,platform);
 // Account-level movements retain AR/advance transfers without counting them as new cash.
 const [r]=await sql`WITH movements AS(
  SELECT e.id AS entry_id,l.account_id,a.code AS account_code,a.name AS account_name,a.role AS account_role,
   e.entry_date,e.reference,e.description,e.source_type,e.source_id,e.source_event,e.posted_at,
   sum(l.debit_minor::numeric) AS debit,sum(l.credit_minor::numeric) AS credit
  FROM ledger_lines l JOIN ledger_entries e ON e.company_id=l.company_id AND e.entity_id=l.entity_id AND e.id=l.entry_id
  JOIN ledger_accounts a ON a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
  WHERE l.company_id=${c.company_id} AND l.entity_id=${c.entity_id} AND l.customer_id=${c.customer_id}
   AND a.role IN('receivable','customer_advance') AND e.state='posted' AND e.entry_date<=${c.to}::date
  GROUP BY e.id,l.account_id,a.code,a.name,a.role,e.entry_date,e.reference,e.description,e.source_type,e.source_id,e.source_event,e.posted_at
 ), opening AS(SELECT coalesce(sum(debit-credit),0) AS amount FROM movements WHERE entry_date<${c.from}::date),
 closing AS(SELECT coalesce(sum(debit-credit) FILTER(WHERE account_role='receivable'),0) AS receivable,
  coalesce(sum(credit-debit) FILTER(WHERE account_role='customer_advance'),0) AS advance FROM movements),
 period AS(SELECT * FROM movements WHERE entry_date>=${c.from}::date),
 summary AS(SELECT count(*)::int AS total,coalesce(sum(debit),0) AS debit,coalesce(sum(credit),0) AS credit FROM period),
 running AS(SELECT *, (SELECT amount FROM opening)+sum(debit-credit) OVER(ORDER BY entry_date,posted_at,entry_id,account_code,account_id ROWS UNBOUNDED PRECEDING) AS balance FROM period),
 page AS(SELECT * FROM running ORDER BY entry_date,posted_at,entry_id,account_code,account_id LIMIT ${exportAll?10001:50} OFFSET ${exportAll?0:(c.page-1)*50})
 SELECT summary.total,opening.amount::text AS opening_minor,summary.debit::text AS debit_minor,summary.credit::text AS credit_minor,
  (opening.amount+summary.debit-summary.credit)::text AS closing_minor,closing.receivable::text AS receivable_minor,closing.advance::text AS advance_minor,
  coalesce((SELECT jsonb_agg(jsonb_build_object('entry_id',entry_id,'account_id',account_id,'account_code',account_code,'account_name',account_name,'account_role',account_role,
   'entry_date',entry_date,'reference',reference,'description',description,'source_type',source_type,'source_id',source_id,'source_event',source_event,
   'debit_minor',debit::text,'credit_minor',credit::text,'balance_minor',balance::text) ORDER BY entry_date,posted_at,entry_id,account_code,account_id) FROM page),'[]'::jsonb) AS rows
 FROM summary CROSS JOIN opening CROSS JOIN closing`;
 if(exportAll&&r.total>10000)throw new ServiceError('STATEMENT_EXPORT_LIMIT',422);
 return {...dims,from:c.from,to:c.to,currency:'EGP',page:exportAll?1:c.page,page_size:exportAll?10000:50,...r} as CustomerStatement;
}
export const CUSTOMER_AGING_BUCKETS=['current','days_1_30','days_31_60','days_61_90','days_91_plus'] as const;
export type CustomerAgingRow={installment_id:string;customer_id:string;customer_name:string;contract_id:string;contract_number:string;project_name:string;unit_code:string;number:number;due_date:string;days_overdue:number;amount_minor:string;collected_minor:string;settled_minor:string;returned_minor:string;balance_minor:string;due_minor:string;credit_minor:string;bucket:typeof CUSTOMER_AGING_BUCKETS[number]};
export type CustomerAging={entity:{id:string;code:string;name:string};customer:{id:string;full_name:string}|null;as_of:string;currency:string;page:number;page_size:number;total:number;due_minor:string;credit_minor:string;net_minor:string;ledger_receivable_minor:string;ledger_advance_minor:string;ledger_net_minor:string;difference_minor:string;pending_events:number;buckets:Record<typeof CUSTOMER_AGING_BUCKETS[number],string>;rows:CustomerAgingRow[]};
export async function customerAging(sql:Sql,actor:Actor,data:unknown,platform=false,exportAll=false):Promise<CustomerAging>{
 const c=base.extend({as_of:date,currency:z.enum(['EGP','USD','EUR','GBP','SAR','AED','QAR','CHF','CAD','AUD','CNY']).default('EGP')}).strict().parse(data);
 const dims=await dimensions(sql,actor,c,platform);
 // Commercial contracts currently belong to the company's default entity only.
 if(!dims.entity.is_default)throw new ServiceError('CUSTOMER_AGING_DEFAULT_ENTITY',422);
 const [r]=await sql`WITH source AS(
  SELECT i.id AS installment_id,c.customer_id,k.full_name AS customer_name,c.id AS contract_id,c.contract_number,p.name AS project_name,u.code AS unit_code,
   i.number,i.due_date,i.amount_minor::numeric,coalesce(col.amount,0) AS collected,coalesce(adj.settled,0) AS settled,coalesce(adj.returned,0) AS returned,
   greatest(${c.as_of}::date-i.due_date,0) AS days_overdue
  FROM contract_installments i JOIN contracts c ON c.company_id=i.company_id AND c.id=i.contract_id
  JOIN crm_customers k ON k.company_id=c.company_id AND k.id=c.customer_id
  JOIN projects p ON p.company_id=c.company_id AND p.id=c.project_id
  JOIN inventory_units u ON u.company_id=c.company_id AND u.project_id=c.project_id AND u.id=c.unit_id
  LEFT JOIN LATERAL(SELECT sum(d.amount_minor::numeric) AS amount FROM collections d
   WHERE d.company_id=i.company_id AND d.contract_id=c.id AND d.installment_id=i.id AND d.status='confirmed'
    AND (d.received_at AT TIME ZONE 'Africa/Cairo')::date<=${c.as_of}::date) col ON true
  LEFT JOIN LATERAL(SELECT sum(d.amount_minor::numeric) FILTER(WHERE d.kind='settlement') AS settled,
   sum(d.amount_minor::numeric) FILTER(WHERE d.kind IN('refund','reversal')) AS returned FROM financial_adjustments d
   WHERE d.company_id=i.company_id AND d.contract_id=c.id AND d.installment_id=i.id AND d.status='executed'
    AND (d.executed_at AT TIME ZONE 'Africa/Cairo')::date<=${c.as_of}::date) adj ON true
  WHERE i.company_id=${c.company_id} AND (c.signed_at AT TIME ZONE 'Africa/Cairo')::date<=${c.as_of}::date
   AND (c.cancelled_at IS NULL OR (c.cancelled_at AT TIME ZONE 'Africa/Cairo')::date>${c.as_of}::date)
   AND c.status IN('active','completed','cancelled') AND (c.status<>'cancelled' OR c.cancelled_at IS NOT NULL)
   AND coalesce(c.payment_plan_snapshot->'book'->>'currency','EGP')=${c.currency}
   AND (${c.customer_id}::uuid IS NULL OR c.customer_id=${c.customer_id}::uuid)
 ), balances AS(SELECT *,amount_minor-collected-settled+returned AS balance,
  CASE WHEN days_overdue=0 THEN 'current' WHEN days_overdue<=30 THEN 'days_1_30' WHEN days_overdue<=60 THEN 'days_31_60' WHEN days_overdue<=90 THEN 'days_61_90' ELSE 'days_91_plus' END AS bucket FROM source),
 open_items AS(SELECT *,greatest(balance,0) AS due,greatest(-balance,0) AS credit FROM balances WHERE balance<>0),
 totals AS(SELECT count(*)::int AS total,coalesce(sum(due),0) AS due,coalesce(sum(credit),0) AS credit,
  coalesce(sum(due) FILTER(WHERE bucket='current'),0) AS current,
  coalesce(sum(due) FILTER(WHERE bucket='days_1_30'),0) AS days_1_30,
  coalesce(sum(due) FILTER(WHERE bucket='days_31_60'),0) AS days_31_60,
  coalesce(sum(due) FILTER(WHERE bucket='days_61_90'),0) AS days_61_90,
  coalesce(sum(due) FILTER(WHERE bucket='days_91_plus'),0) AS days_91_plus FROM open_items),
 gl AS(SELECT coalesce(sum(coalesce(l.amount_currency_minor,l.debit_minor::numeric-l.credit_minor::numeric)) FILTER(WHERE a.role='receivable'),0) AS receivable,
  coalesce(-sum(coalesce(l.amount_currency_minor,l.debit_minor::numeric-l.credit_minor::numeric)) FILTER(WHERE a.role='customer_advance'),0) AS advance
  FROM ledger_lines l JOIN ledger_entries e ON e.company_id=l.company_id AND e.entity_id=l.entity_id AND e.id=l.entry_id
  JOIN ledger_accounts a ON a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
  WHERE l.company_id=${c.company_id} AND l.entity_id=${c.entity_id} AND a.role IN('receivable','customer_advance') AND e.state='posted'
   AND e.entry_date<=${c.as_of}::date AND l.currency_code=${c.currency} AND (${c.customer_id}::uuid IS NULL OR l.customer_id=${c.customer_id}::uuid)),
 pending AS(SELECT count(*)::int AS n FROM finance_events f WHERE f.company_id=${c.company_id} AND f.status='pending'
  AND (f.event_at AT TIME ZONE 'Africa/Cairo')::date<=${c.as_of}::date AND coalesce(f.payload->>'currency_code','EGP')=${c.currency}
  AND (${c.customer_id}::uuid IS NULL OR f.customer_id=${c.customer_id}::uuid)),
 page AS(SELECT * FROM open_items ORDER BY due_date,installment_id LIMIT ${exportAll?10001:50} OFFSET ${exportAll?0:(c.page-1)*50})
 SELECT total,due::text AS due_minor,credit::text AS credit_minor,(due-credit)::text AS net_minor,
  gl.receivable::text AS ledger_receivable_minor,gl.advance::text AS ledger_advance_minor,(gl.receivable-gl.advance)::text AS ledger_net_minor,
  (due-credit-gl.receivable+gl.advance)::text AS difference_minor,pending.n AS pending_events,
  jsonb_build_object('current',current::text,'days_1_30',days_1_30::text,'days_31_60',days_31_60::text,'days_61_90',days_61_90::text,'days_91_plus',days_91_plus::text) AS buckets,
  coalesce((SELECT jsonb_agg(jsonb_build_object('installment_id',installment_id,'customer_id',customer_id,'customer_name',customer_name,'contract_id',contract_id,
   'contract_number',contract_number,'project_name',project_name,'unit_code',unit_code,'number',number,'due_date',due_date,'days_overdue',days_overdue,'bucket',bucket,
   'amount_minor',amount_minor::text,'collected_minor',collected::text,'settled_minor',settled::text,'returned_minor',returned::text,'balance_minor',balance::text,'due_minor',due::text,'credit_minor',credit::text)
   ORDER BY due_date,installment_id) FROM page),'[]'::jsonb) AS rows FROM totals CROSS JOIN gl CROSS JOIN pending`;
 if(exportAll&&r.total>10000)throw new ServiceError('AGING_EXPORT_LIMIT',422);
 return {...dims,as_of:c.as_of,currency:c.currency,page:exportAll?1:c.page,page_size:exportAll?10000:50,...r} as CustomerAging;
}
