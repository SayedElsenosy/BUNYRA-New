import {neon} from '@neondatabase/serverless';
import {testSavedOffers} from './test-saved-offers.mjs';
const url=process.env.BUNYRA_TEST_DATABASE_URL;
if(!url||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('An isolated DEV database and explicit fixture flag are required');
const {pdf,...result}=await testSavedOffers(neon(url));console.log(JSON.stringify(result,null,2));
