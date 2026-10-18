import { identity,sameOrigin,json,failure } from '../../../../lib/bunyra/http';
import { acceptInvite } from '../../../../lib/bunyra/service';
import { z } from 'zod';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await identity();const body=z.object({token:z.string()}).parse(await request.json());return json(await acceptInvite(sql,actor,body.token));}catch(e){return failure(e);}}
