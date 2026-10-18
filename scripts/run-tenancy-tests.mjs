import { neon } from '@neondatabase/serverless';
import { runTenancyTests } from './test-tenancy.mjs';
const url=process.env.BUNYRA_TEST_DATABASE_URL;
if(!url||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('Set BUNYRA_TEST_DATABASE_URL for an isolated test database and BUNYRA_ALLOW_TEST_FIXTURES=1. Never use production.');
console.log(JSON.stringify(await runTenancyTests(neon(url)),null,2));
