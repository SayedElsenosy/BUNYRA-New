import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
const month=z.string().regex(/^\\d{4}-(0[1-9]|1[0-2])-01$/);
const base=z.object({company_id:uuid,entity_id:uuid});
const query=base.extend({from_month:month,to_month:month,project_id:uuid.nullable().default(null)}).strict();
const draft=base.extend({project_id:uuid,expense_account_id:uuid,period_month:month,
 amount_minor:z.string().regex(/^[1-9]\\d{0,17}$/),reason:z.string().trim().min(5).max(500)}).strict();
const approve=z.object({company_id:uuid,budget_id:uuid}).strict();
async function manager(sql:Sql,actor:Actor,company:string,action:'finance.read'|'finance.write'|'finance.approve',platform:boolean){
 const ctx=await access(sql,actor,company,action,platform);
 if(!ctx.owner&&!['company_admin','finance_manager'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
}
function sum(rows:readonly Record<string,unknown>[],key:string){
 return rows.reduce((total,row)=>total+BigInt(String(row[key]||'0')),BigInt(0)).toString();
}
export async function projectBudgetOverview(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=query.parse(input);await manager(sql,actor,c.company_id,'finance.read',platform);
 if(c.from_month>c.to_month)throw new ServiceError('INVALID_DATE_RANGE',400);
 const entities=await sql`SELECT id FROM ledger_entities WHERE company_id=${c.company_id} AND id=${c.entity_id}`;
 if(!entities.length)throw new ServiceError('NOT_FOUND',404);
 if(c.project_id){
  const projects=await sql`SELECT id FROM projects WHERE company_id=${c.company_id} AND id=${c.project_id}`;
  if(!projects.length)throw new ServiceError('NOT_FOUND',404);
 }
 const [rows,drafts]=await Promise.all([
  sql`WITH actual AS (
   SELECT l.company_id,l.entity_id,l.project_id,l.account_id AS expense_account_id,
    date_trunc('month',e.entry_date)::date AS period_month,
    sum(l.debit_minor::numeric-l.credit_minor::numeric) AS amount_minor
   FROM ledger_entries e
   JOIN ledger_lines l ON l.company_id=e.company_id AND l.entity_id=e.entity_id AND l.entry_id=e.id
   JOIN ledger_accounts acc ON acc.company_id=l.company_id AND acc.entity_id=l.entity_id AND acc.id=l.account_id
   WHERE e.company_id=${c.company_id} AND e.entity_id=${c.entity_id} AND e.state='posted'
    AND l.project_id IS NOT NULL AND acc.kind='expense'
    AND e.entry_date>=${c.from_month}::date
    AND e.entry_date<(${c.to_month}::date+interval '1 month')
    AND (${c.project_id}::uuid IS NULL OR l.project_id=${c.project_id}::uuid)
   GROUP BY l.company_id,l.entity_id,l.project_id,l.account_id,date_trunc('month',e.entry_date)::date
  )
  SELECT COALESCE(b.project_id,a.project_id) AS project_id,p.name AS project_name,
    COALESCE(b.expense_account_id,a.expense_account_id) AS expense_account_id,
    acc.code AS account_code,acc.name AS account_name,
    COALESCE(b.period_month,a.period_month)::text AS period_month,
    COALESCE(b.amount_minor,0)::text AS budget_minor,
    COALESCE(a.amount_minor,0)::text AS actual_minor,
    (COALESCE(b.amount_minor,0)::numeric-COALESCE(a.amount_minor,0))::text AS variance_minor,
    b.id AS approved_budget_id,b.version
  FROM (SELECT * FROM finance_project_budgets WHERE company_id=${c.company_id}
   AND entity_id=${c.entity_id} AND status='approved'
   AND period_month BETWEEN ${c.from_month}::date AND ${c.to_month}::date
   AND (${c.project_id}::uuid IS NULL OR project_id=${c.project_id}::uuid)) b
  FULL OUTER JOIN actual a ON a.company_id=b.company_id AND a.entity_id=b.entity_id
   AND a.project_id=b.project_id AND a.expense_account_id=b.expense_account_id
   AND a.period_month=b.period_month
  JOIN projects p ON p.company_id=COALESCE(b.company_id,a.company_id) AND p.id=COALESCE(b.project_id,a.project_id)
  JOIN ledger_accounts acc ON acc.company_id=COALESCE(b.company_id,a.company_id)
   AND acc.entity_id=COALESCE(b.entity_id,a.entity_id) AND acc.id=COALESCE(b.expense_account_id,a.expense_account_id)
  ORDER BY period_month DESC,p.name,acc.code LIMIT 3000`,
  sql`SELECT b.id,b.project_id,p.name AS project_name,b.expense_account_id,
    acc.code AS account_code,b.period_month::text,b.version,b.amount_minor::text,b.reason
    FROM finance_project_budgets b
    JOIN projects p ON p.company_id=b.company_id AND p.id=b.project_id
    JOIN ledger_accounts acc ON acc.company_id=b.company_id AND acc.entity_id=b.entity_id AND acc.id=b.expense_account_id
    WHERE b.company_id=${c.company_id} AND b.entity_id=${c.entity_id} AND b.status='draft'
     AND b.period_month BETWEEN ${c.from_month}::date AND ${c.to_month}::date
     AND (${c.project_id}::uuid IS NULL OR b.project_id=${c.project_id}::uuid)
    ORDER BY b.created_at DESC LIMIT 300`
 ]);
 return {rows,drafts,totals:{budget_minor:sum(rows,'budget_minor'),actual_minor:sum(rows,'actual_minor'),
  variance_minor:sum(rows,'variance_minor')},scope:'approved monthly expense budgets vs posted project-tagged expense GL lines',
  note:'Unallocated expense journal lines are excluded. Unbudgeted project expenses appear with zero budget. Reports above 3000 rows are truncated.'};
}
export async function createProjectBudget(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=draft.parse(input);await manager(sql,actor,c.company_id,'finance.write',platform);
 const valid=(await sql`SELECT EXISTS(
  SELECT 1 FROM projects p JOIN ledger_entities ent ON ent.company_id=p.company_id
   AND ent.id=${c.entity_id} AND ent.active
  JOIN ledger_accounts a ON a.company_id=ent.company_id AND a.entity_id=ent.id
   AND a.id=${c.expense_account_id} AND a.kind='expense' AND a.active AND a.allow_posting
  WHERE p.company_id=${c.company_id} AND p.id=${c.project_id}
 ) AS ok`)[0];
 if(!valid?.ok)throw new ServiceError('BUDGET_INVALID_PROJECT_OR_ACCOUNT',422);
 const id=crypto.randomUUID();
 const lockKey=[c.company_id,c.entity_id,c.project_id,c.expense_account_id,c.period_month].join(':');
 const results=await sql.transaction([
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey},0))`,
  sql`INSERT INTO finance_project_budgets(
   id,company_id,entity_id,project_id,expense_account_id,period_month,version,amount_minor,reason,created_by)
   VALUES(${id},${c.company_id},${c.entity_id},${c.project_id},${c.expense_account_id},
    ${c.period_month}::date,
    (SELECT COALESCE(MAX(version),0)+1 FROM finance_project_budgets
      WHERE company_id=${c.company_id} AND entity_id=${c.entity_id} AND project_id=${c.project_id}
        AND expense_account_id=${c.expense_account_id} AND period_month=${c.period_month}::date),
    ${c.amount_minor}::bigint,${c.reason},${actor.userId})
   RETURNING id,version,status`,
  sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
   VALUES(${c.company_id},${actor.userId},${actor.email},'finance.project_budget_drafted',
    jsonb_build_object('budget_id',${id}::uuid,'project_id',${c.project_id}::uuid,
      'period_month',${c.period_month}::date,'amount_minor',${c.amount_minor}::bigint)) RETURNING id`
 ]);
 return {budget:results[1][0]};
}
export async function approveProjectBudget(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=approve.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const row=(await sql`SELECT bunyra_approve_project_budget(${c.company_id}::uuid,${c.budget_id}::uuid) AS id`)[0];
 return {id:row.id,status:'approved'};
}
