import {identity,json,failure} from '../../../lib/bunyra/http';
import {dealsInsights} from '../../../lib/bunyra/deals-insights';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity();
  const url=new URL(request.url);
  const {company='',mode,...filters}=Object.fromEntries(url.searchParams);
  return json(await dealsInsights(sql,actor,company,filters,mode==='platform'));
 }catch(error){return failure(error);}
}
