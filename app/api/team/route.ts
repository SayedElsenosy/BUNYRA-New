import { identity,sameOrigin,json,failure } from '../../../lib/bunyra/http';
import { listMembers,issueInvite,revokeInvite,changeMember,saveRole,setPermission } from '../../../lib/bunyra/service';
import { z } from 'zod';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {sql,actor}=await identity();const url=new URL(request.url);return json(await listMembers(sql,actor,url.searchParams.get('company')||'',url.searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await identity();const body=z.object({operation:z.enum(['invite','revoke','member','role','permission'])}).passthrough().parse(await request.json());const platform=new URL(request.url).searchParams.get('mode')==='platform';switch(body.operation){
 case 'invite':{const result=await issueInvite(sql,actor,body,platform);return json({id:result.id,join_path:'/join#token='+result.token},201);}
 case 'revoke':return json(await revokeInvite(sql,actor,String(body.company_id||''),String(body.id||''),platform));
 case 'member':return json(await changeMember(sql,actor,body,platform));
 case 'role':return json(await saveRole(sql,actor,body,platform));
 case 'permission':return json(await setPermission(sql,actor,body,platform));
 default:return json({error:'INVALID_OPERATION'},400);
 }}catch(e){return failure(e);}}
