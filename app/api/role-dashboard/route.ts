import {identity,json,failure} from '../../../lib/bunyra/http';
import {roleDashboard} from '../../../lib/bunyra/role-dashboard';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity();
  const url=new URL(request.url);
  const company=url.searchParams.get('company')||'';
  const platform=url.searchParams.get('mode')==='platform';
  return json(await roleDashboard(sql,actor,{company},platform));
 }catch(error){return failure(error);}
}
