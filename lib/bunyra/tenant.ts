import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;
type Scope = { company: string; user: string };
type Query = ReturnType<Sql>;

const RAW = Symbol('bunyra.raw');
const scopes = new WeakMap<object, Scope | null>();

// Wraps a Neon HTTP client so that, once bindTenant() is called, every query
// runs inside a transaction as role bunyra_tenant with app.company_id and
// app.user_id set. Row Level Security then enforces company isolation even if
// a query forgets its company filter. Unbound queries keep the server role.
export function tenantSql(base: Sql): Sql {
  const prefix = (s: Scope) => [
    base`SET LOCAL ROLE bunyra_tenant`,
    base`SELECT set_config('app.company_id',${s.company},true),set_config('app.user_id',${s.user},true)`,
  ];
  const run = (q: Query) => {
    const s = scopes.get(wrapped);
    return s ? base.transaction([...prefix(s), q]).then(r => r[2]) : q;
  };
  const lazy = (q: Query) => {
    let started: Promise<unknown> | undefined;
    const exec = () => (started ??= Promise.resolve(run(q)));
    return {
      [RAW]: q,
      [Symbol.toStringTag]: 'NeonQueryPromise',
      then: (ok?: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => exec().then(ok, fail),
      catch: (fail?: (e: unknown) => unknown) => exec().catch(fail),
      finally: (done?: () => void) => exec().finally(done),
    } as unknown as Query;
  };
  const wrapped = ((strings: TemplateStringsArray, ...values: unknown[]) => lazy(base(strings, ...values))) as Sql;
  const unwrap = (q: unknown) => ((q as Record<symbol, Query>)[RAW] ?? q) as Query;
  Object.assign(wrapped, {
    query: (text: string, params?: unknown[]) => lazy(base.query(text, params)),
    // Do not leak the raw Neon client: its queries bypass the tenant RLS role.
    unsafe: () => { throw new Error('TENANT_UNSAFE_QUERY_BLOCKED'); },
    transaction: (queries: unknown, opts?: Parameters<Sql['transaction']>[1]) => {
      const list = (typeof queries === 'function' ? queries(wrapped) : queries) as unknown[];
      const raw = list.map(unwrap);
      const s = scopes.get(wrapped);
      return s ? base.transaction([...prefix(s), ...raw], opts).then(r => r.slice(2)) : base.transaction(raw, opts);
    },
  });
  scopes.set(wrapped, null);
  return wrapped;
}

export function bindTenant(sql: Sql, company: string | null, user?: string) {
  if (!scopes.has(sql)) return;
  scopes.set(sql, company && user ? { company, user } : null);
}

export function tenantScope(sql: Sql) {
  return scopes.get(sql) ?? null;
}
