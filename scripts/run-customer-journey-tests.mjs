import {neon} from '@neondatabase/serverless';
import {runHubTests} from './test-workspace-hub.mjs';
import {testCustomerJourney} from './test-customer-journey.mjs';
const url=process.env.BUNYRA_TEST_DATABASE_URL;
if(!url||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('An isolated DEV database and explicit fixture flag are required');
const raw=neon(url),hub=await runHubTests(raw),journey=await testCustomerJourney(raw,hub.fixture);console.log(JSON.stringify({hub,journey,passed:hub.passed+journey.passed},null,2));
