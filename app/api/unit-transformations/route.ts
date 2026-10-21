import {requireEntitled} from '../../../lib/bunyra/subscriptions';
import {identity,sameOrigin,json,failure} from '../../../lib/bunyra/http';
import {saveUnitTransformation} from '../../../lib/bunyra/unit-transformations';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await identity();const text=await request.text();if(text.length>100000)return json({error:'FILE_TOO_LARGE'},413);const body=JSON.parse(text),platform=new URL(request.url).searchParams.get('mode')==='platform';await requireEntitled(sql,actor,String(body.company_id||''),'inventory',platform);return json(await saveUnitTransformation(sql,actor,body,platform),201);}catch(e){return failure(e);}}
