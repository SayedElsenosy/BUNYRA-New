import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';
await assertFixtureDatabaseTarget();
import {neon} from '@neondatabase/serverless';
import {testReportBoundaries} from './test-commission-report-boundaries.mjs';
import {runCommissionTests} from './test-commissions-reports.mjs';
const url=process.env.BUNYRA_TEST_DATABASE_URL;if(!url||process.env.BUNYRA_ALLOW_TEST_FIXTURES!=='1')throw Error('An isolated DEV database and explicit test-fixture flag are required.');
const db=neon(url),main=await runCommissionTests(db),boundaries=await testReportBoundaries(db,main.fixture);console.log(JSON.stringify({main,boundaries,passed:main.passed+boundaries.passed},null,2));
