import {neon} from '@neondatabase/serverless';import {runAccountTests} from './test-accounts.mjs';
const url=process.env.BUNYRA_TEST_DATABASE_URL;if(!url||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('Use an isolated test database and explicitly enable fixtures. Never use production.');
console.log(JSON.stringify(await runAccountTests(neon(url)),null,2));
