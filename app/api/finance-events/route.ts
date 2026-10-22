import {z} from 'zod';
import {identity,sameOrigin,json,failure} from '../../../lib/bunyra/http';
import {financeEventsOverview,configureFinanceMapping,postFinanceEvent} from '../../../lib/bunyra/finance-events';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity(),url=new URL(request.url);
  return json(await financeEventsOverview(sql,actor,url.searchParams.get('company')||'',url.searchParams.get('mode')==='platform'));
 }catch(e){return failure(e);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const {sql,actor}=await identity(),url=new URL(request.url);
  const body=z.record(z.string(),z.unknown()).parse(await request.json());
  const {operation,...input}=body;
  const platform=url.searchParams.get('mode')==='platform';
  if(operation==='configure_mapping')return json(await configureFinanceMapping(sql,actor,input,platform));
  if(operation==='post_event')return json(await postFinanceEvent(sql,actor,input,platform));
  return json({error:'INVALID_OPERATION'},400);
 }catch(e){return failure(e);}
}
