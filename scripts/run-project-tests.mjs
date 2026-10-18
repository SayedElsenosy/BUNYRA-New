import {neon} from '@neondatabase/serverless';
import {runProjectTests} from './test-projects.mjs';
if(!process.env.BUNYRA_TEST_DATABASE_URL||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('An isolated test branch and explicit fixture opt-in are required. Never use production.');
console.log(JSON.stringify(await runProjectTests(neon(process.env.BUNYRA_TEST_DATABASE_URL)),null,2));
