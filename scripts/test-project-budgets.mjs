import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const migration=fs.readFileSync('db/045-project-budgets.sql','utf8');
const api=fs.readFileSync('lib/bunyra/project-budgets.ts','utf8');
const route=fs.readFileSync('app/api/ledger/budgets/route.ts','utf8');
let passed=0;function check(label,fn){fn();passed++;console.log('PASS '+label);}
check('Project and entity FK prevent foreign-company allocations',()=>{
 for(const marker of ['FOREIGN KEY(company_id,project_id)','FOREIGN KEY(company_id,entity_id,expense_account_id)','FOREIGN KEY(company_id,entity_id)','bunyra_tenant_company()'])
  assert.ok(migration.includes(marker),marker);
});
check('RLS is forced; no direct budget UPDATE or DELETE privilege',()=>{
 assert.match(migration,/FORCE ROW LEVEL SECURITY/);
 assert.match(migration,/GRANT SELECT,INSERT ON finance_project_budgets TO bunyra_tenant/);
 assert.doesNotMatch(migration,/GRANT (?:UPDATE|DELETE)/);
});
check('Approved budgets have single active version and immutable contents',()=>{
 for(const marker of ["WHERE status='draft'","WHERE status='approved'","status='superseded'","BUDGET_IMMUTABLE","BUDGET_DELETE_FORBIDDEN","FOR UPDATE"])
  assert.ok(migration.includes(marker),marker);
});
check('Approval checks tenant identity and finance role in database',()=>{
 assert.match(migration,/IF p_company IS DISTINCT FROM bunyra_tenant_company\(\)/);
 assert.match(migration,/role IN\('company_admin','finance_manager'\)/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION bunyra_approve_project_budget/);
});
check('Actuals count only posted project-tagged expense ledger lines',()=>{
 for(const marker of ["e.state='posted'","l.project_id IS NOT NULL","acc.kind='expense'","FULL OUTER JOIN actual","status='approved'"])
  assert.ok(api.includes(marker),marker);
});
check('Creation and approval require scoped service access and audit',()=>{
 assert.match(api,/manager\(sql,actor,c.company_id,'finance.write'/);
 assert.match(api,/manager\(sql,actor,c.company_id,'finance.approve'/);
 assert.match(api,/sql.transaction/);
 assert.match(api,/finance.project_budget_drafted/);
 assert.match(migration,/finance.project_budget_approved/);
});
check('API uses authenticated identity and same-origin for mutations',()=>{
 assert.match(route,/await identity\(\)/);
 assert.match(route,/sameOrigin\(request\)/);
});
check('TypeScript service transpiles',()=>{
 const output=ts.transpileModule(api,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(output.diagnostics?.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
});
console.log('PASS '+passed+' project budget guards');
