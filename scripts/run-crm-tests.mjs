import { neon } from '@neondatabase/serverless';
import { runCrmTests } from './test-crm.mjs';
const url = process.env.BUNYRA_TEST_DATABASE_URL;
if (!url || process.env.BUNYRA_ALLOW_TEST_FIXTURES !== '1') throw Error('An isolated test database and BUNYRA_ALLOW_TEST_FIXTURES=1 are required. Never run fixtures on production.');
const sql = neon(url);
const owners = await sql`SELECT user_id FROM platform_owner`;
if (owners.length && owners[0].user_id !== 'identity-test-platform-owner') throw Error('Refusing to run CRM fixtures in a database with a real platform owner. Use a test database.');
console.log(JSON.stringify(await runCrmTests(sql), null, 2));
