import {identity,json,failure} from '../../../lib/bunyra/http';
import {customerAccountChoices,customerAging,customerStatement} from '../../../lib/bunyra/customer-accounts';
import {customerAgingXlsx,customerStatementXlsx} from '../../../lib/bunyra/customer-accounts-export';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {sql,actor}=await identity(),p=new URL(request.url).searchParams,platform=p.get('mode')==='platform',download=p.get('format')==='xlsx';
 if(p.get('report')==='choices')return json(await customerAccountChoices(sql,actor,{company_id:p.get('company'),q:p.get('q')||''},platform));
 const args={company_id:p.get('company'),entity_id:p.get('entity'),customer_id:p.get('customer')||null,page:p.get('page')||1};
 const aging=p.get('report')==='aging';
 if(aging){const d=await customerAging(sql,actor,{...args,as_of:p.get('as_of'),currency:p.get('currency')||'EGP'},platform,download);
  if(!download)return json(d);
  return file(customerAgingXlsx(d,p.get('language')==='en'),'customer-aging.xlsx');
 }
 const d=await customerStatement(sql,actor,{...args,from:p.get('from'),to:p.get('to')},platform,download);
 if(!download)return json(d);
 return file(customerStatementXlsx(d,p.get('language')==='en'),'customer-statement.xlsx');
}catch(e){return failure(e)}}
function file(bytes:Uint8Array,name:string){return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'no-store'}})}
