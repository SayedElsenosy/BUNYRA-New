import {identity,json,failure,sameOrigin} from '../../../lib/bunyra/http';
import {workspaceAlerts,readWorkspaceAlert} from '../../../lib/bunyra/workspace-alerts';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity();
  const u=new URL(request.url);
  const input=Object.fromEntries([...u.searchParams].filter(([key])=>key!=='mode'));
  return json(await workspaceAlerts(sql,actor,input,u.searchParams.get('mode')==='platform'));
 }catch(error){return failure(error);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const {sql,actor}=await identity();
  return json(await readWorkspaceAlert(sql,actor,await request.json(),new URL(request.url).searchParams.get('mode')==='platform'));
 }catch(error){return failure(error);}
}
