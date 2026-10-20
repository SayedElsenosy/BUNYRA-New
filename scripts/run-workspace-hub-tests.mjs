import {neon} from '@neondatabase/serverless';
import {testHubBoundaries} from './test-workspace-boundaries.mjs';
import {runHubTests} from './test-workspace-hub.mjs';
const url=process.env.BUNYRA_TEST_DATABASE_URL;
if(!url||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('An isolated DEV database and explicit fixture flag are required');
const db=neon(url),main=await runHubTests(db),boundaries=await testHubBoundaries(db,main.fixture);console.log(JSON.stringify({main,boundaries,passed:main.passed+boundaries.passed},null,2));
