import {neon} from '@neondatabase/serverless';
import {runPricingTests} from './test-pricing.mjs';
const url=process.env.BUNYRA_TEST_DATABASE_URL;
if(!url||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('An isolated development database and BUNYRA_ALLOW_TEST_FIXTURES=1 are required. Never run fixtures in production.');
console.log(JSON.stringify(await runPricingTests(neon(url)),null,2));
