import {neon} from '@neondatabase/serverless';
import {testLeadActions} from './test-lead-actions.mjs';
if(!process.env.BUNYRA_TEST_DATABASE_URL||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('Isolated DEV required');
const {fixture,...result}=await testLeadActions(neon(process.env.BUNYRA_TEST_DATABASE_URL));
console.log(JSON.stringify(result,null,2));
