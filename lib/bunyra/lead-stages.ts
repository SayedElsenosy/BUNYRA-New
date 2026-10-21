export const LEAD_STAGES = [
  ['fresh','جديد','Fresh','new'],
  ['follow_up','متابعة','Follow up','contacted'],
  ['not_interested','غير مهتم','Not Interested','lost'],
  ['no_answer','لا يرد','No Answer','contacted'],
  ['interested','مهتم','Interested','qualified'],
  ['meeting','اجتماع','Meeting','qualified'],
  ['call_back','إعادة اتصال','Call Back','contacted'],
  ['reschedule_meeting','إعادة جدولة الاجتماع','Reschedule meeting','qualified'],
  ['outdoor','زيارة خارجية','outdoor','qualified'],
  ['following_after_meeting','متابعة بعد الاجتماع','Following after meeting','qualified'],
  ['reservation','حجز','Reservation','proposal'],
  ['archive','أرشيف','Archive','paused'],
  ['done_deal','صفقة مكتملة','Done deal','won'],
  ['unreachable','تعذر الوصول','Unreachable','contacted'],
  ['cancellation','إلغاء','Cancellation','lost'],
] as const;
export type LeadStage = typeof LEAD_STAGES[number][0];
export const stageLabel = (code:string,en=false) => {
  const stage=LEAD_STAGES.find(s=>s[0]===code);
  return stage ? stage[en?2:1] : code;
};
export const terminalStage = (stage:string) => ['not_interested','archive','done_deal','cancellation'].includes(stage);
export const stageFromStatus = (status:string):LeadStage => ({new:'fresh',contacted:'follow_up',qualified:'interested',proposal:'reservation',won:'done_deal',lost:'not_interested',paused:'archive'} as Record<string,LeadStage>)[status]||'fresh';
export function companyDate(value:Date,zone:string) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function nextActionPreset(preset:'hour'|'two_hours'|'tomorrow'|'week',zone:string,now=new Date()) {
  if(preset==='hour'||preset==='two_hours')return companyDate(new Date(now.getTime()+(preset==='hour'?1:2)*3600000),zone);
  // Calendar presets preserve the company's wall-clock time across DST changes.
  const wall=new Date(companyDate(now,zone)+'Z');
  wall.setUTCDate(wall.getUTCDate()+(preset==='tomorrow'?1:7));
  return wall.toISOString().slice(0,16);
}
export function stageAge(value:string|undefined,now:number,en=false) {
  if(!value)return en?'Tracking starts on update':'يبدأ التتبع مع التحديث';
  const minutes=Math.max(0,Math.floor((now-new Date(value).getTime())/60000));
  if(minutes<60)return `${minutes} ${en?'min':'دقيقة'}`;
  if(minutes<1440)return `${Math.floor(minutes/60)} ${en?'hours':'ساعة'}`;
  return `${Math.floor(minutes/1440)} ${en?'days':'يوم'}`;
}
