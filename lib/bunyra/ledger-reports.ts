import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {buildFinancialStatements,summarizeTrialBalance,type StatementAccount} from './ledger-report-utils';

const query=z.object({company_id:uuid,entity_id:uuid,from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),project_id:uuid.nullable().default(null)}).strict();
export async function ledgerFinancialReport(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=query.parse(input);
 const scope=await access(sql,actor,c.company_id,'finance.read',platform,c.project_id||undefined);
 if(!scope.owner&&!['company_admin','finance_manager'].includes(scope.role))throw new ServiceError('FORBIDDEN',403);
 // A complete company statement includes every project and unallocated lines.
 // Refuse it for restricted readers rather than leaking denied projects or
 // silently presenting a partial, potentially unbalanced financial statement.
 // Explicit project reports are already checked by access() above.
 if(!scope.owner&&!c.project_id&&scope.overrides.some(permission=>
  permission.action==='finance.read'&&permission.project_id!==null&&!permission.allowed
 ))throw new ServiceError('FORBIDDEN',403);
 if(c.from>c.to)throw new ServiceError('INVALID_DATE_RANGE',400);
 const found=await sql`SELECT id FROM ledger_entities WHERE company_id=${c.company_id} AND id=${c.entity_id}`;
 if(!found.length)throw new ServiceError('NOT_FOUND',404);
 const [accounts,projects,asOfAccounts]=await Promise.all([
  sql`SELECT a.id,a.code,a.name,a.kind,a.role,
    sum(l.debit_minor::numeric)::text AS debit_minor,
    sum(l.credit_minor::numeric)::text AS credit_minor
   FROM ledger_entries e
   JOIN ledger_lines l ON l.company_id=e.company_id AND l.entity_id=e.entity_id AND l.entry_id=e.id
   JOIN ledger_accounts a ON a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
   WHERE e.company_id=${c.company_id} AND e.entity_id=${c.entity_id} AND e.state='posted'
    AND e.entry_date>=${c.from}::date AND e.entry_date<=${c.to}::date
    AND (${c.project_id}::uuid IS NULL OR l.project_id=${c.project_id}::uuid)
   GROUP BY a.id,a.code,a.name,a.kind,a.role ORDER BY a.code`,
  sql`SELECT l.project_id,p.name AS project_name,
   sum(CASE WHEN a.kind='income' THEN l.credit_minor::numeric-l.debit_minor::numeric ELSE 0 END)::text AS income_minor,
   sum(CASE WHEN a.kind='expense' THEN l.debit_minor::numeric-l.credit_minor::numeric ELSE 0 END)::text AS expenses_minor,
   sum(l.debit_minor::numeric)::text AS debits_minor,sum(l.credit_minor::numeric)::text AS credits_minor
   FROM ledger_entries e
   JOIN ledger_lines l ON l.company_id=e.company_id AND l.entity_id=e.entity_id AND l.entry_id=e.id
   JOIN ledger_accounts a ON a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
   LEFT JOIN projects p ON p.company_id=l.company_id AND p.id=l.project_id
   WHERE e.company_id=${c.company_id} AND e.entity_id=${c.entity_id} AND e.state='posted'
    AND e.entry_date>=${c.from}::date AND e.entry_date<=${c.to}::date
    AND (${c.project_id}::uuid IS NULL OR l.project_id=${c.project_id}::uuid)
   GROUP BY l.project_id,p.name ORDER BY project_name NULLS LAST`,
  sql`SELECT a.id,a.code,a.name,a.kind,a.role,
    sum(l.debit_minor::numeric)::text AS debit_minor,
    sum(l.credit_minor::numeric)::text AS credit_minor
   FROM ledger_entries e
   JOIN ledger_lines l ON l.company_id=e.company_id AND l.entity_id=e.entity_id AND l.entry_id=e.id
   JOIN ledger_accounts a ON a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
   WHERE e.company_id=${c.company_id} AND e.entity_id=${c.entity_id} AND e.state='posted'
    AND e.entry_date<=${c.to}::date
    AND (${c.project_id}::uuid IS NULL OR l.project_id=${c.project_id}::uuid)
   GROUP BY a.id,a.code,a.name,a.kind,a.role ORDER BY a.code`
 ]);
 const statementLine=(r:Record<string,any>):StatementAccount=>({
  id:String(r.id),code:String(r.code),name:String(r.name),kind:r.kind as StatementAccount['kind'],
  debit_minor:String(r.debit_minor),credit_minor:String(r.credit_minor)
 });
 const summary=summarizeTrialBalance(accounts.map(r=>({
  kind:r.kind,debit_minor:r.debit_minor,credit_minor:r.credit_minor
 })));
 return {company_id:c.company_id,entity_id:c.entity_id,from:c.from,to:c.to,project_id:c.project_id,
  trial_balance:accounts,project_analytics:projects,summary,...buildFinancialStatements(accounts.map(statementLine),asOfAccounts.map(statementLine)),
  note:'Unaudited EGP statements from posted entries. Opening balances must be recorded; project-filtered statements can be non-balancing if journal legs lack project dimensions.'};
}
