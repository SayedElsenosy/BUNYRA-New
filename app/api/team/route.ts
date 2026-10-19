import { identity,sameOrigin,json,failure } from '../../../lib/bunyra/http';
import { listMembers,revokeInvite,changeMember,saveRole,setPermission } from '../../../lib/bunyra/service';
import { z } from 'zod';
import { createAccount,resetAccount,setAccountLimit } from '../../../lib/bunyra/accounts';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {sql,actor}=await identity();const url=new URL(request.url);return json(await listMembers(sql,actor,url.searchParams.get('company')||'',url.searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await identity();const body=z.object({operation:z.enum(['create_account','reset_account','limit','revoke','member','role','permission'])}).passthrough().parse(await request.json());const platform=new URL(request.url).searchParams.get('mode')==='platform';switch(body.operation){
 case 'create_account':return json(await createAccount(sql,actor,body,platform),201);
 case 'reset_account':return json(await resetAccount(sql,actor,body,platform));
 case 'limit':return json(await setAccountLimit(sql,actor,body));
 case 'revoke':return json(await revokeInvite(sql,actor,String(body.company_id||''),String(body.id||''),platform));
 case 'member':return json(await changeMember(sql,actor,body,platform));
 case 'role':return json(await saveRole(sql,actor,body,platform));
 case 'permission':return json(await setPermission(sql,actor,body,platform));
 default:return json({error:'INVALID_OPERATION'},400);
 }}catch(e){return failure(e);}}
