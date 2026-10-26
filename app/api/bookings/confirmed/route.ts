import {z} from 'zod';
import {sameOrigin,json,failure} from '../../../../lib/bunyra/http';
import {createConfirmedBooking} from '../../../../lib/bunyra/create-confirmed-booking';
export const dynamic='force-dynamic';
/** Admin-only one-step confirmation; ordinary sales use /api/commercial. */
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const data=z.record(z.string(),z.unknown()).parse(await request.json());
  return json(await createConfirmedBooking(data),201);
 }catch(e){return failure(e);}
}
