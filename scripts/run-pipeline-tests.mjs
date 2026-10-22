import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
import {neon} from '@neondatabase/serverless';import {testPipeline} from './test-pipeline.mjs';
if(!process.env.BUNYRA_TEST_DATABASE_URL||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('Isolated DEV fixtures required');
const {fixture,...result}=await testPipeline(neon(process.env.BUNYRA_TEST_DATABASE_URL));console.log(JSON.stringify({...result,fixture_company:fixture.company},null,2));
