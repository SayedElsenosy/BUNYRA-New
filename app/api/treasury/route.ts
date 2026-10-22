import {createPaymentAccount} from '../../../lib/bunyra/payment-accounts';
import {z} from 'zod';
import {identity,sameOrigin,json,failure} from '../../../lib/bunyra/http';
import {treasuryOverview,createBankStatement,importBankLines,reconcileBankLine,closeBankStatement} from '../../../lib/bunyra/treasury';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity(),url=new URL(request.url);
  return json(await treasuryOverview(sql,actor,url.searchParams.get('company')||'',url.searchParams.get('mode')==='platform'));
 }catch(e){return failure(e);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const {sql,actor}=await identity(),url=new URL(request.url);
  const {operation,...input}=z.record(z.string(),z.unknown()).parse(await request.json());
  const owner=url.searchParams.get('mode')==='platform';
  if(operation==='create_account')return json(await createPaymentAccount(sql,actor,input,owner),201);
  if(operation==='create_statement')return json(await createBankStatement(sql,actor,input,owner),201);
  if(operation==='import_lines')return json(await importBankLines(sql,actor,input,owner),201);
  if(operation==='match_line')return json(await reconcileBankLine(sql,actor,input,owner));
  if(operation==='close_statement')return json(await closeBankStatement(sql,actor,input,owner));
  return json({error:'INVALID_OPERATION'},400);
 }catch(e){return failure(e);}
}
