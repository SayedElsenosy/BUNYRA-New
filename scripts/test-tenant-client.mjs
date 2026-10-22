import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const directory = '.sites-runtime/tenant-client-tests';
fs.mkdirSync(directory, { recursive: true });
const source = fs.readFileSync('lib/bunyra/tenant.ts', 'utf8');
fs.writeFileSync(directory + '/tenant.mjs', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText);
const { tenantSql, bindTenant, tenantScope } = await import('../' + directory + '/tenant.mjs');

const calls = [];
const base = (strings, ...values) => ({ type: 'tag', text: strings.join('?'), values });
base.query = (statement, params) => ({ type: 'query', text: statement, values: params });
base.unsafe = () => { throw Error('RAW_CLIENT_CALLED'); };
base.transaction = async (queries) => {
  calls.push(queries);
  return queries.map((query) => [query]);
};

const sql = tenantSql(base);
const checks = [];
const test = async (name, run) => { await run(); checks.push(name); };

await test('unsafe raw client method cannot bypass tenant isolation', () => {
  assert.throws(() => sql.unsafe('SELECT 1'), /TENANT_UNSAFE_QUERY_BLOCKED/);
});
await test('scoped tagged queries set local role and company/user identity', async () => {
  bindTenant(sql, 'company-a', 'user-a');
  const result = await sql(['SELECT ', ' AS value'], 123);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 3);
  assert.match(calls[0][0].text, /SET LOCAL ROLE bunyra_tenant/);
  assert.deepEqual(calls[0][1].values, ['company-a', 'user-a']);
  assert.equal(calls[0][2].values[0], 123);
  assert.equal(result[0].values[0], 123);
});
await test('scoped text queries use the same RLS wrapper', async () => {
  await sql.query('SELECT * FROM companies WHERE id=$1', ['company-a']);
  assert.equal(calls[1].length, 3);
  assert.equal(calls[1][2].type, 'query');
  assert.deepEqual(calls[1][2].values, ['company-a']);
});
await test('transactions use one scoped role and tenant context', async () => {
  const output = await sql.transaction([sql(['SELECT 1']), sql(['SELECT 2'])]);
  assert.equal(calls[2].length, 4);
  assert.equal(output.length, 2);
  assert.deepEqual(calls[2][1].values, ['company-a', 'user-a']);
});
await test('rebinding updates the tenant identity for later queries', async () => {
  bindTenant(sql, 'company-b', 'user-b');
  await sql(['SELECT 3']);
  assert.deepEqual(calls[3][1].values, ['company-b', 'user-b']);
  assert.deepEqual(tenantScope(sql), { company: 'company-b', user: 'user-b' });
});
await test('unbound authorization queries still work but unsafe stays blocked', async () => {
  bindTenant(sql, null);
  assert.equal(tenantScope(sql), null);
  assert.deepEqual(await sql(['SELECT 4']), { type: 'tag', text: 'SELECT 4', values: [] });
  assert.equal(calls.length, 4);
  assert.throws(() => sql.unsafe('SELECT 1'), /TENANT_UNSAFE_QUERY_BLOCKED/);
});
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
