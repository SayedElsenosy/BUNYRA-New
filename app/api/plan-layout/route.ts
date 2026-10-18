import {identity,sameOrigin,json,failure} from '../../../lib/bunyra/http';
import {getPlanLayout,savePlanLayout} from '../../../lib/bunyra/plan-layout';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {sql,actor}=await identity(),u=new URL(request.url);return json(await getPlanLayout(sql,actor,u.searchParams.get('company')||'',u.searchParams.get('project')||'',u.searchParams.get('file')||'',u.searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await identity();const text=await request.text();if(text.length>1500000)return json({error:'FILE_TOO_LARGE'},413);return json(await savePlanLayout(sql,actor,JSON.parse(text),new URL(request.url).searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
