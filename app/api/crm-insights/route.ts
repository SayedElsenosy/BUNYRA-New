import {identity,json,failure} from '../../../lib/bunyra/http';
import {crmInsights} from '../../../lib/bunyra/crm-insights';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {sql,actor}=await identity();const u=new URL(request.url);return json(await crmInsights(sql,actor,u.searchParams.get('company')||'',Object.fromEntries([...u.searchParams].filter(([k])=>!['company','mode'].includes(k))),u.searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
