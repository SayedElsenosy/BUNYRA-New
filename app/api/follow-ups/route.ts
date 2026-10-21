import {identity,json,failure,sameOrigin} from '../../../lib/bunyra/http';
import {followUpOverview,changeFollowUp} from '../../../lib/bunyra/follow-ups';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {sql,actor}=await identity(),u=new URL(request.url);return json(await followUpOverview(sql,actor,u.searchParams.get('company')||'',{bucket:u.searchParams.get('bucket')||'all',page:u.searchParams.get('page')||0,id:u.searchParams.get('id')||undefined},u.searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await identity();const input=await request.json();if(!Number.isInteger(input.version)||input.version<1)return json({error:'VALIDATION_ERROR'},400);return json(await changeFollowUp(sql,actor,input,new URL(request.url).searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
