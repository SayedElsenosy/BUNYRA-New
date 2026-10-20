import {z} from 'zod';
import {identity,sameOrigin,json,failure} from '../../../lib/bunyra/http';
import {commissionOverview,configureCommission,postCommission} from '../../../lib/bunyra/commissions';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {sql,actor}=await identity(),u=new URL(request.url),{company='',mode,...filters}=Object.fromEntries(u.searchParams);return json(await commissionOverview(sql,actor,company,filters,mode==='platform'));}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await identity(),{operation,...data}=z.record(z.string(),z.unknown()).parse(await request.json()),platform=new URL(request.url).searchParams.get('mode')==='platform';if(operation==='configure')return json(await configureCommission(sql,actor,data,platform));if(operation==='post')return json(await postCommission(sql,actor,data,platform),201);return json({error:'INVALID_OPERATION'},400);}catch(e){return failure(e);}}
