import { neon } from '@neondatabase/serverless';
import { runIdentityTests } from './test-identity.mjs';
const url=process.env.BUNYRA_TEST_DATABASE_URL;
if(!url||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('Set BUNYRA_TEST_DATABASE_URL for an isolated development branch and BUNYRA_ALLOW_TEST_FIXTURES=1. Never use production.');
const report=await runIdentityTests(neon(url));
console.log(JSON.stringify(report,null,2));
