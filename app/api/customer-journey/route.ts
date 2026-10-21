import {requireEntitled} from '../../../lib/bunyra/subscriptions';
import {identity,json,failure} from '../../../lib/bunyra/http';
import {customerJourney} from '../../../lib/bunyra/customer-journey';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{const {sql,actor}=await identity();const u=new URL(request.url);await requireEntitled(sql,actor,u.searchParams.get('company')||'','crm',u.searchParams.get('mode')==='platform');return json(await customerJourney(sql,actor,Object.fromEntries(u.searchParams),u.searchParams.get('mode')==='platform'));}
 catch(error){return failure(error);}
}
