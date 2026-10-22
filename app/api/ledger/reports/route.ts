import {identity,json,failure} from '../../../../lib/bunyra/http';
import {ledgerFinancialReport} from '../../../../lib/bunyra/ledger-reports';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity(),url=new URL(request.url),q=url.searchParams;
  return json(await ledgerFinancialReport(sql,actor,{
   company_id:q.get('company'),entity_id:q.get('entity'),
   from:q.get('from'),to:q.get('to'),project_id:q.get('project')||null
  },q.get('mode')==='platform'));
 }catch(error){return failure(error);}
}
