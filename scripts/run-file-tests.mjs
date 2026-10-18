import {neon} from '@neondatabase/serverless';
import {runFileTests,testStorage} from './test-files.mjs';
if(!process.env.BUNYRA_TEST_DATABASE_URL||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1'||!process.env.BUNYRA_TEST_STORAGE_ENDPOINT)throw Error('Explicit isolated database/storage branches and fixture opt-in required. Never use production.');
console.log(JSON.stringify(await runFileTests(neon(process.env.BUNYRA_TEST_DATABASE_URL),testStorage({endpoint:process.env.BUNYRA_TEST_STORAGE_ENDPOINT,region:'eu-central-1',credentials:{accessKeyId:process.env.BUNYRA_TEST_STORAGE_KEY,secretAccessKey:process.env.BUNYRA_TEST_STORAGE_SECRET}})),null,2));
