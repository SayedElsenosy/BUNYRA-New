import {identity,json,failure} from '../../../lib/bunyra/http';
import {salesReports} from '../../../lib/bunyra/sales-reports';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {sql,actor}=await identity(),u=new URL(request.url),{company='',mode,...filters}=Object.fromEntries(u.searchParams);return json(await salesReports(sql,actor,company,filters,mode==='platform'));}catch(e){return failure(e);}}
