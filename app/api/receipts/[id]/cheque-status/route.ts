import {z} from 'zod';
import {identity,sameOrigin,json,failure} from '../../../../../lib/bunyra/http';
import {clearPendingCheque,bouncePendingCheque} from '../../../../../lib/bunyra/cheques';

export const dynamic='force-dynamic';
const uuid=z.string().uuid();
const actionSchema=z.discriminatedUnion('action',[
 z.object({company_id:uuid,action:z.literal('BOUNCED'),reason:z.string().trim().min(3).max(500),mode:z.enum(['platform']).optional()}).strict(),
 z.object({company_id:uuid,action:z.literal('CLEARED'),payment_account_id:uuid,
  exchange_rate:z.string().regex(/^\d{1,10}(\.\d{1,8})?$/).optional(),
  mode:z.enum(['platform']).optional()}).strict()
]);
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  sameOrigin(request);
  const {id}=await params;
  uuid.parse(id);
  const input=actionSchema.parse(await request.json());
  const {sql,actor}=await identity();
  if(input.action==='BOUNCED')
   return json(await bouncePendingCheque(sql,actor,{
    company_id:input.company_id,receipt_id:id,reason:input.reason
   },input.mode==='platform'));
  return json(await clearPendingCheque(sql,actor,{
   company_id:input.company_id,receipt_id:id,
   payment_account_id:input.payment_account_id,exchange_rate:input.exchange_rate
  },input.mode==='platform'));
 }catch(error){return failure(error);}
}
