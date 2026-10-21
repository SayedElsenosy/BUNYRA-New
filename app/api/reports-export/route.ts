import {identity,failure} from '../../../lib/bunyra/http';
import {ServiceError} from '../../../lib/bunyra/service';
import {salesReports} from '../../../lib/bunyra/sales-reports';
import {dealsInsights} from '../../../lib/bunyra/deals-insights';
import {salesReportCsv,dealsReportCsv,type DealsExportKind} from '../../../lib/bunyra/report-csv';

export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity();
  const url=new URL(request.url);
  const {company='',mode,report,detail,...filters}=Object.fromEntries(url.searchParams);
  delete filters.page; // CSV is not the current table page.
  const platform=mode==='platform';
  let output:string;
  let label:string;
  if(report==='sales'){
   if(detail)throw new ServiceError('INVALID_EXPORT_KIND',400);
   const data=(await salesReports(sql,actor,company,filters,platform,true)) as unknown as {rows:Parameters<typeof salesReportCsv>[0];can_read_commissions:boolean};
   if(!Array.isArray(data.rows))throw new ServiceError('EXPORT_FAILED',503);
   output=salesReportCsv(data.rows,data.can_read_commissions);
   label='sales';
  }else if(report==='deals'){
   if(!['summary','projects','timeline'].includes(detail||''))throw new ServiceError('INVALID_EXPORT_KIND',400);
   const data=(await dealsInsights(sql,actor,company,filters,platform)) as unknown as Parameters<typeof dealsReportCsv>[0];
   if(!Array.isArray(data.projects)||!Array.isArray(data.trend)||!Array.isArray(data.money))throw new ServiceError('EXPORT_FAILED',503);
   if(data.projects.length>10000||data.trend.length>10000)throw new ServiceError('EXPORT_TOO_LARGE',413);
   output=dealsReportCsv(data,detail as DealsExportKind);
   label='deals-'+detail;
  }else throw new ServiceError('INVALID_EXPORT_KIND',400);
  return new Response(output,{status:200,headers:{
   'Content-Type':'text/csv; charset=utf-8',
   'Content-Disposition':'attachment; filename="bunyra-'+label+'-report.csv"',
   'Cache-Control':'private, no-store, max-age=0',
   'X-Content-Type-Options':'nosniff',
  }});
 }catch(error){return failure(error);}
}
