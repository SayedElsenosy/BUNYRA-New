import fs from 'node:fs';
import { Pool, neonConfig } from '@neondatabase/serverless';

// Applies db/NNN-*.sql in order, each inside one transaction, recording every
// version in schema_migrations. Usage: node scripts/migrate.mjs [--status]
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error('Set MIGRATE_DATABASE_URL or DATABASE_URL');
if (globalThis.WebSocket) neonConfig.webSocketConstructor = globalThis.WebSocket;
const statusOnly = process.argv.includes('--status');
const dir = new URL('../db/', import.meta.url);
const files = fs.readdirSync(dir).filter(f => /^\d{3}-[\w-]+\.sql$/.test(f)).sort();
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('bunyra_schema_migrations'))");
  const table = (await client.query("SELECT to_regclass('public.schema_migrations') AS t")).rows[0].t;
  const applied = new Set(table ? (await client.query('SELECT version FROM schema_migrations')).rows.map(r => r.version) : []);
  for (const file of files) {
    const version = file.slice(0, -4);
    if (applied.has(version)) { if (statusOnly) console.log(`applied  ${version}`); continue; }
    if (statusOnly) { console.log(`pending  ${version}`); continue; }
    const body = fs.readFileSync(new URL(file, dir), 'utf8');
    const script = /^\s*BEGIN\s*;/i.test(body.replace(/--[^\n]*(?:\n|$)/g, '')) ? body : `BEGIN;\n${body}\nCOMMIT;`;
    try { await client.query(script); }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw new Error(`${version} failed: ${error.message}`); }
    if (!(await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version])).rowCount)
      throw new Error(`${version} did not record itself in schema_migrations`);
    console.log(`applied  ${version}`);
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('bunyra_schema_migrations'))").catch(() => {});
  client.release();
  await pool.end();
}
