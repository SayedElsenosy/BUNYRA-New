import {identity,sameOrigin,json,failure} from '../../../lib/bunyra/http';
import {organization,saveSettings,saveNode,savePlacement} from '../../../lib/bunyra/organization';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {sql,actor}=await identity();const u=new URL(request.url);return json(await organization(sql,actor,u.searchParams.get('company')||'',u.searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await identity();const body=z.object({operation:z.enum(['settings','node','placement'])}).passthrough().parse(await request.json());const mode=new URL(request.url).searchParams.get('mode')==='platform';switch(body.operation){case 'settings':return json(await saveSettings(sql,actor,body,mode));case 'node':return json(await saveNode(sql,actor,body,mode));case 'placement':return json(await savePlacement(sql,actor,body,mode));}}catch(e){if((e as {code?:string})?.code==='23514')return json({error:'ORGANIZATION_CONSTRAINT'},409);return failure(e);}}
