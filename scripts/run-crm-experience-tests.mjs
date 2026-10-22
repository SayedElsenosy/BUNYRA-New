import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
import {neon} from '@neondatabase/serverless';
import {testCrmExperience} from './test-crm-experience.mjs';
if(!process.env.BUNYRA_TEST_DATABASE_URL||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('Isolated DEV required');
const {fixture,...result}=await testCrmExperience(neon(process.env.BUNYRA_TEST_DATABASE_URL));
console.log(JSON.stringify(result,null,2));
