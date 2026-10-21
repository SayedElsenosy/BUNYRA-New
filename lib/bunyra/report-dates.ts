/** Report date shortcuts are calendar dates in the COMPANY time zone. */
export type ReportPreset='today'|'week'|'month'|'30days';
export type ReportWindow={from:string;to:string};
export function reportWindow(preset:ReportPreset,zone:string,now=new Date()):ReportWindow{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(type:string)=>Number(parts.find(item=>item.type===type)?.value);
  const year=part('year'),month=part('month'),day=part('day');
  if(!year||!month||!day)throw new Error('INVALID_REPORT_DATE');
  const current=Date.UTC(year,month-1,day);
  const asDate=(utc:number)=>new Date(utc).toISOString().slice(0,10);
  const to=asDate(current);
  if(preset==='today')return {from:to,to};
  if(preset==='month')return {from:asDate(Date.UTC(year,month-1,1)),to};
  if(preset==='week'){
    const weekday=new Date(current).getUTCDay();
    const offset=(weekday+6)%7; // Monday-first
    return {from:asDate(current-offset*86400000),to};
  }
  if(preset==='30days')return {from:asDate(current-29*86400000),to};
  throw new Error('INVALID_REPORT_PRESET');
}
