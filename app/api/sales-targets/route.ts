import {identity,sameOrigin,json,failure} from '../../../lib/bunyra/http';
import {salesTargets,saveSalesTarget} from '../../../lib/bunyra/sales-targets';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {sql,actor}=await identity();const u=new URL(request.url);return json(await salesTargets(sql,actor,u.searchParams.get('company')||'',u.searchParams.get('quarter')||undefined,u.searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await identity();return json(await saveSalesTarget(sql,actor,await request.json(),new URL(request.url).searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
