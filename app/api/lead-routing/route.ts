import {requireEntitled} from '../../../lib/bunyra/subscriptions';
import {identity,json,failure,sameOrigin} from '../../../lib/bunyra/http';
import {getLeadRouting,saveLeadRouting} from '../../../lib/bunyra/lead-routing';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity();
  const url=new URL(request.url);
  await requireEntitled(sql,actor,url.searchParams.get('company')||'','crm',url.searchParams.get('mode')==='platform');
  return json(await getLeadRouting(sql,actor,url.searchParams.get('company')||'',url.searchParams.get('mode')==='platform'));
 }catch(error){return failure(error);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const {sql,actor}=await identity();
  const body=await request.json(),platform=new URL(request.url).searchParams.get('mode')==='platform';await requireEntitled(sql,actor,String(body.company_id||''),'crm',platform);return json(await saveLeadRouting(sql,actor,body,platform));
 }catch(error){return failure(error);}
}
