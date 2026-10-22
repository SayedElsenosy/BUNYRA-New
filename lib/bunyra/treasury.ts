import {z} from 'zod';
import {access,ServiceError,uuid,type Actor,type Sql} from './service';
import {assertBankStatementBalance} from './treasury-utils';
async function manager(sql:Sql,actor:Actor,company:string,action:'finance.read'|'finance.write'|'finance.approve',platform:boolean){
 const scope=await access(sql,actor,company,action,platform);
 if(!scope.owner&&!['company_admin','finance_manager'].includes(scope.role))throw new ServiceError('FORBIDDEN',403);
}
const signed=z.string().regex(/^-?\d{1,18}$/);
const statement=z.object({
 company_id:uuid,entity_id:uuid,bank_account_id:uuid,
 statement_ref:z.string().trim().min(2).max(120),date_from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 date_to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),opening_minor:signed,closing_minor:signed
}).strict();
const line=z.object({
 external_ref:z.string().trim().min(1).max(180),
 booked_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 signed_minor:signed,description:z.string().max(500).default('')
}).strict();
const importInput=z.object({company_id:uuid,statement_id:uuid,lines:z.array(line).min(1).max(500)}).strict();
const target=z.object({company_id:uuid,statement_id:uuid}).strict();
const matchInput=z.object({company_id:uuid,bank_line_id:uuid,ledger_line_id:uuid}).strict();

export async function treasuryOverview(sql:Sql,actor:Actor,company:string,platform=false){
 await manager(sql,actor,company,'finance.read',platform);
 const [statements,lines,matches,candidates]=await Promise.all([
  sql`SELECT id,entity_id,bank_account_id,statement_ref,date_from,date_to,
    opening_minor::text,closing_minor::text,status,closed_at FROM treasury_bank_statements
    WHERE company_id=${company} ORDER BY date_to DESC LIMIT 200`,
  sql`SELECT id,entity_id,statement_id,external_ref,booked_on,signed_minor::text,description FROM treasury_bank_lines
    WHERE company_id=${company} ORDER BY booked_on DESC LIMIT 1000`,
  sql`SELECT id,entity_id,bank_line_id,ledger_line_id,matched_at FROM treasury_bank_matches
    WHERE company_id=${company} ORDER BY matched_at DESC LIMIT 1000`,
  sql`SELECT l.id,l.entity_id,l.account_id,a.code AS account_code,e.reference,
     l.debit_minor::text,l.credit_minor::text,e.entry_date
     FROM ledger_lines l
     JOIN ledger_entries e ON e.company_id=l.company_id AND e.entity_id=l.entity_id AND e.id=l.entry_id
     JOIN ledger_accounts a ON a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
     WHERE l.company_id=${company} AND a.role='bank' AND e.state='posted'
       AND NOT EXISTS(SELECT 1 FROM treasury_bank_matches x WHERE x.ledger_line_id=l.id)
     ORDER BY e.entry_date DESC LIMIT 500`
 ]);
 return {statements,lines,matches,candidates,matching_scope:'posted_bank_gl_lines_exact_amount'};
}
export async function createBankStatement(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=statement.parse(input);await manager(sql,actor,c.company_id,'finance.write',platform);
 if(c.date_from>c.date_to)throw new ServiceError('INVALID_DATE_RANGE',400);
 const bank=(await sql`SELECT id FROM ledger_accounts WHERE company_id=${c.company_id}
  AND entity_id=${c.entity_id} AND id=${c.bank_account_id} AND role='bank' AND active AND allow_posting`)[0];
 if(!bank)throw new ServiceError('TREASURY_INVALID_BANK_ACCOUNT',422);
 const result=(await sql`INSERT INTO treasury_bank_statements(company_id,entity_id,bank_account_id,
  statement_ref,date_from,date_to,opening_minor,closing_minor,created_by)
 VALUES(${c.company_id},${c.entity_id},${c.bank_account_id},${c.statement_ref},
  ${c.date_from}::date,${c.date_to}::date,${c.opening_minor}::bigint,${c.closing_minor}::bigint,${actor.userId})
 RETURNING id,statement_ref,status`)[0];
 return {statement:result};
}
export async function importBankLines(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=importInput.parse(input);await manager(sql,actor,c.company_id,'finance.write',platform);
 const stmt=(await sql`SELECT id,date_from,date_to,status FROM treasury_bank_statements
 WHERE company_id=${c.company_id} AND id=${c.statement_id}`)[0];
 if(!stmt||stmt.status!=='open')throw new ServiceError('TREASURY_STATEMENT_CLOSED',409);
 const used=new Set<string>();
 for(const item of c.lines){
  if(item.signed_minor==='0'||BigInt(item.signed_minor)===BigInt(0)||item.booked_on<stmt.date_from||item.booked_on>stmt.date_to
   ||used.has(item.external_ref))throw new ServiceError('TREASURY_INVALID_LINE',422);
  used.add(item.external_ref);
 }
 const results=await sql`INSERT INTO treasury_bank_lines(company_id,entity_id,statement_id,external_ref,booked_on,signed_minor,description)
 SELECT s.company_id,s.entity_id,s.id,x.external_ref,x.booked_on,x.signed_minor,x.description
 FROM treasury_bank_statements s,
 jsonb_to_recordset(${JSON.stringify(c.lines)}::jsonb)
  AS x(external_ref text,booked_on date,signed_minor bigint,description text)
 WHERE s.company_id=${c.company_id} AND s.id=${c.statement_id} AND s.status='open'
 RETURNING id,external_ref`;
 if(results.length!==c.lines.length)throw new ServiceError('TREASURY_STATEMENT_CLOSED',409);
 return {imported:results};
}
export async function reconcileBankLine(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=matchInput.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const row=(await sql`SELECT bunyra_bank_match(${c.company_id}::uuid,${c.bank_line_id}::uuid,
  ${c.ledger_line_id}::uuid) AS match_id`)[0];
 return {match_id:row.match_id,state:'matched'};
}
export async function closeBankStatement(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=target.parse(input);await manager(sql,actor,c.company_id,'finance.approve',platform);
 const rows=await sql`SELECT opening_minor::text AS opening,closing_minor::text AS closing FROM treasury_bank_statements
  WHERE company_id=${c.company_id} AND id=${c.statement_id}`;
 if(!rows.length)throw new ServiceError('TREASURY_STATEMENT_NOT_FOUND',404);
 const amounts=await sql`SELECT signed_minor::text FROM treasury_bank_lines
  WHERE company_id=${c.company_id} AND statement_id=${c.statement_id}`;
 try{assertBankStatementBalance(rows[0].opening,rows[0].closing,amounts.map(a=>a.signed_minor));}
 catch(e){throw new ServiceError((e as Error).message,409);}
 const result=(await sql`SELECT bunyra_close_bank_statement(${c.company_id}::uuid,${c.statement_id}::uuid) AS id`)[0];
 return {id:result.id,status:'closed'};
}
