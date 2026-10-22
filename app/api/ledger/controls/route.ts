import {z} from 'zod';
import {identity,sameOrigin,json,failure} from '../../../../lib/bunyra/http';
import {ledgerControlsOverview,lockLedgerPeriod,reverseLedgerJournal} from '../../../../lib/bunyra/ledger-controls';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity(),url=new URL(request.url);
  return json(await ledgerControlsOverview(sql,actor,url.searchParams.get('company')||'',url.searchParams.get('mode')==='platform'));
 }catch(e){return failure(e);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const {sql,actor}=await identity(),url=new URL(request.url);
  const {operation,...input}=z.record(z.string(),z.unknown()).parse(await request.json());
  const mode=url.searchParams.get('mode')==='platform';
  if(operation==='lock_period')return json(await lockLedgerPeriod(sql,actor,input,mode));
  if(operation==='reverse_journal')return json(await reverseLedgerJournal(sql,actor,input,mode));
  return json({error:'INVALID_OPERATION'},400);
 }catch(e){return failure(e);}
}
