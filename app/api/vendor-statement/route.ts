import {identity,json,failure} from '../../../lib/bunyra/http';
import {vendorStatement} from '../../../lib/bunyra/vendor-statement';
import {vendorStatementXlsx} from '../../../lib/bunyra/vendor-statement-export';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {sql,actor}=await identity(),p=new URL(request.url).searchParams,download=p.get('format')==='xlsx';
 const data=await vendorStatement(sql,actor,{company_id:p.get('company'),entity_id:p.get('entity'),vendor_id:p.get('vendor'),from:p.get('from'),to:p.get('to'),page:p.get('page')||1},p.get('mode')==='platform',download);
 if(!download)return json(data);
 return new Response(new Uint8Array(vendorStatementXlsx(data,p.get('language')==='en')),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="supplier-statement.xlsx"','Cache-Control':'no-store'}});
}catch(e){return failure(e)}}
