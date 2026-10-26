import {z} from 'zod';
import {identity,sameOrigin,json,failure} from '../../../../lib/bunyra/http';
import {getCompanyCheques,issuePendingCheque,bouncePendingCheque,clearPendingCheque} from '../../../../lib/bunyra/cheques';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 try {
  const {sql,actor}=await identity();
  const url=new URL(request.url),company=url.searchParams.get('company')||'';
  const platform=url.searchParams.get('mode')==='platform';
  return json(await getCompanyCheques(sql,actor,company,platform));
 } catch(e) {return failure(e);}
}
export async function POST(request:Request) {
 try {
  sameOrigin(request);
  const {sql,actor}=await identity();
  const {operation,...data}=z.object({operation:z.enum(['issue','clear','bounce'])}).passthrough().parse(await request.json());
  const platform=new URL(request.url).searchParams.get('mode')==='platform';
  if(operation==='issue')return json(await issuePendingCheque(sql,actor,data,platform),201);
  if(operation==='bounce')return json(await bouncePendingCheque(sql,actor,data,platform));
  return json(await clearPendingCheque(sql,actor,data,platform));
 } catch(e) {return failure(e);}
}
