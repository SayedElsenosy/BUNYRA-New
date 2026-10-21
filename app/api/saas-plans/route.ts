import {platformIdentity,json,failure,sameOrigin} from '../../../lib/bunyra/http';
import {listPlanCatalog,savePlan,assignPlan} from '../../../lib/bunyra/subscriptions';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(){try{const {sql,actor}=await platformIdentity();return json(await listPlanCatalog(sql,actor));}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await platformIdentity();
 const body=z.object({operation:z.enum(['save_plan','assign_plan']),data:z.unknown()}).strict().parse(await request.json());
 return json(body.operation==='save_plan'?await savePlan(sql,actor,body.data):await assignPlan(sql,actor,body.data));}catch(e){return failure(e);}}
