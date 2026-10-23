// OpenNext generates this module during build; retain its fetch implementation.
// @ts-ignore generated worker has no checked-in declaration
import handler from './.open-next/worker.js';
import {runFinanceSchedule} from './hosting/finance-scheduler.mjs';

export default {
 fetch:handler.fetch,
 async scheduled(_event:unknown,env:{DATABASE_URL?:string}){
  try{
   const result=await runFinanceSchedule(env);
   console.log(JSON.stringify({event:'finance_outbox_schedule',...result}));
  }catch{
   // Never write database URLs, SQL error detail or customer data to worker logs.
   console.error('finance_outbox_schedule_failed');
   throw new Error('FINANCE_SCHEDULE_FAILED');
  }
 }
};
