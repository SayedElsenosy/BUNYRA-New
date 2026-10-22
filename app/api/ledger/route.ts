import {z} from 'zod';
import {identity,sameOrigin,json,failure} from '../../../lib/bunyra/http';
import {ledgerOverview,ledgerCreateAccount,ledgerCreateJournal,ledgerCreateCostCenter,ledgerCreateDraft,ledgerPost} from '../../../lib/bunyra/ledger';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity(),url=new URL(request.url);
  return json(await ledgerOverview(sql,actor,url.searchParams.get('company')||'',url.searchParams.get('mode')==='platform'));
 }catch(error){return failure(error);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const {sql,actor}=await identity(),url=new URL(request.url);
  const {operation,...input}=z.record(z.string(),z.unknown()).parse(await request.json());
  const platform=url.searchParams.get('mode')==='platform';
  if(operation==='account')return json(await ledgerCreateAccount(sql,actor,input,platform),201);
  if(operation==='journal')return json(await ledgerCreateJournal(sql,actor,input,platform),201);
  if(operation==='cost_center')return json(await ledgerCreateCostCenter(sql,actor,input,platform),201);
  if(operation==='draft')return json(await ledgerCreateDraft(sql,actor,input,platform),201);
  if(operation==='post')return json(await ledgerPost(sql,actor,input,platform));
  return json({error:'INVALID_OPERATION'},400);
 }catch(error){return failure(error);}
}
