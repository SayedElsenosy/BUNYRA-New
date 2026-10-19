import {neon} from '@neondatabase/serverless';
import {runCommercialIntegrityTests} from './test-commercial-integrity.mjs';
const url=process.env.BUNYRA_TEST_DATABASE_URL;if(!url||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('An isolated test database and BUNYRA_ALLOW_TEST_FIXTURES=1 are required.');
console.log(JSON.stringify(await runCommercialIntegrityTests(neon(url)),null,2));