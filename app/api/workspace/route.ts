import {identity,json,failure,sameOrigin} from '../../../lib/bunyra/http';
import {workspaceHub,completeWorkItem} from '../../../lib/bunyra/workspace-hub';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {sql,actor}=await identity(),url=new URL(request.url);
 const input=Object.fromEntries([...url.searchParams].filter(([key])=>key!=='mode'));
 return json(await workspaceHub(sql,actor,input,url.searchParams.get('mode')==='platform'));
}catch(error){return failure(error);}}
export async function POST(request:Request){try{
 sameOrigin(request);const {sql,actor}=await identity(),url=new URL(request.url);
 return json(await completeWorkItem(sql,actor,await request.json(),url.searchParams.get('mode')==='platform'));
}catch(error){return failure(error);}}
