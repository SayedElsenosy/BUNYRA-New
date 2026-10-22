import {neon} from '@neondatabase/serverless';
import {testAssignmentHistory} from './test-assignment-history.mjs';
if(!process.env.BUNYRA_TEST_DATABASE_URL||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('Isolated test database required');
console.log(JSON.stringify(await testAssignmentHistory(neon(process.env.BUNYRA_TEST_DATABASE_URL)),null,2));
