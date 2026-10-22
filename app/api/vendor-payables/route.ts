import {z} from 'zod';
import {identity,sameOrigin,json,failure} from '../../../lib/bunyra/http';
import {vendorPayablesOverview,createFinanceVendor,createVendorBill,approveVendorBill,configurePayableMapping,postVendorBill} from '../../../lib/bunyra/vendor-payables';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{const {sql,actor}=await identity(),url=new URL(request.url);
  return json(await vendorPayablesOverview(sql,actor,url.searchParams.get('company')||'',url.searchParams.get('mode')==='platform'));
 }catch(e){return failure(e);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);const {sql,actor}=await identity(),url=new URL(request.url);
  const {operation,...input}=z.record(z.string(),z.unknown()).parse(await request.json());
  const owner=url.searchParams.get('mode')==='platform';
  if(operation==='vendor')return json(await createFinanceVendor(sql,actor,input,owner),201);
  if(operation==='bill')return json(await createVendorBill(sql,actor,input,owner),201);
  if(operation==='approve_bill')return json(await approveVendorBill(sql,actor,input,owner));
  if(operation==='payable_mapping')return json(await configurePayableMapping(sql,actor,input,owner));
  if(operation==='post_bill')return json(await postVendorBill(sql,actor,input,owner));
  return json({error:'INVALID_OPERATION'},400);
 }catch(e){return failure(e);}
}
