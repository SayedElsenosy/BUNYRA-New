import {neon} from '@neondatabase/serverless';

export async function runFinanceSchedule(env){
 if(!env.DATABASE_URL)throw new Error('FINANCE_DATABASE_NOT_CONFIGURED');
 const sql=neon(env.DATABASE_URL);
 const [schema]=await sql`SELECT to_regprocedure('public.bunyra_run_scheduled_finance_outbox()') IS NOT NULL AS ready`;
 if(!schema.ready)return {ready:false};
 const [row]=await sql`SELECT bunyra_run_scheduled_finance_outbox() AS result`;
 return {ready:true,...row.result};
}
