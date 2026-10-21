import {identity,json,failure} from '../../../lib/bunyra/http';
import {companyEntitlements} from '../../../lib/bunyra/subscriptions';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {sql,actor}=await identity();const url=new URL(request.url);return json({subscription:await companyEntitlements(sql,actor,url.searchParams.get('company')||'',url.searchParams.get('mode')==='platform')});}catch(e){return failure(e);}}
