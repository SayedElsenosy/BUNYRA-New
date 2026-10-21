import {bindTenant} from './tenant';
import {z} from 'zod';
import {crmScope} from './crm-scope';
import {ServiceError,uuid,type Sql,type Actor} from './service';
export const repeatKind=z.enum(['none','daily','weekly','monthly']);
export const localDue=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).refine(v=>{const d=new Date(v+'Z');return !v.startsWith('0000')&&!Number.isNaN(d.getTime())&&d.toISOString().slice(0,16)===v;});
const input=z.discriminatedUnion('operation',[
 z.object({company_id:uuid,id:uuid,operation:z.literal('complete'),version:z.number().int().positive().optional(),reason:z.string().trim().max(1000).default('')}),
 z.object({company_id:uuid,id:uuid,operation:z.literal('postpone'),version:z.number().int().positive(),due_local:localDue,reason:z.string().trim().min(3).max(1000)}),
 z.object({company_id:uuid,id:uuid,operation:z.literal('cancel'),version:z.number().int().positive().optional(),reason:z.string().trim().min(3).max(1000)}),
 z.object({company_id:uuid,id:uuid,operation:z.literal('repeat'),version:z.number().int().positive(),repeat_kind:repeatKind,repeat_every:z.number().int().min(1).max(12),reason:z.string().trim().min(3).max(1000)})
]);
async function scope(sql:Sql,actor:Actor,company:string,platform:boolean){
 const read=await crmScope(sql,actor,company,'leads.read',platform);let writeIds:string[]=[],canWrite=false;
 try{const w=await crmScope(sql,actor,company,'leads.write',platform);writeIds=w.ids;canWrite=true;}catch(e){if(!(e instanceof ServiceError)||e.status!==403)throw e;}
 bindTenant(sql,company,actor.userId);
 const settings=(await sql`SELECT COALESCE(s.time_zone,'Africa/Cairo') AS time_zone,COALESCE(s.follow_up_escalation_hours,24) AS hours,now() AS as_of FROM companies c LEFT JOIN company_settings s ON s.company_id=c.id WHERE c.id=${company}`)[0];
 return {read,params:[company,read.users,read.ids,writeIds,canWrite,settings.time_zone,settings.hours],settings,canWrite};
}
const visible=`WITH query_zone AS(SELECT $6::text AS time_zone),visible AS(
 SELECT f.*,c.full_name,m.email AS assignee,
 ($5::boolean AND (f.lead_id IS NULL OR f.lead_id=ANY($4::uuid[]))) AS can_write,
 (f.status='open' AND f.due_at<now()) AS overdue,
 (f.status='open' AND f.due_at<=now()-make_interval(hours=>$7::int)) AS escalated
 FROM crm_follow_ups f JOIN crm_customers c ON c.company_id=f.company_id AND c.id=f.customer_id
 LEFT JOIN memberships m ON m.company_id=f.company_id AND m.user_id=f.assigned_to
 WHERE f.company_id=$1::uuid AND ($2::text[] IS NULL OR f.assigned_to=ANY($2::text[]))
 AND (f.lead_id IS NULL OR f.lead_id=ANY($3::uuid[]))
)`;
export async function followUpOverview(sql:Sql,actor:Actor,company:string,query:unknown={},platform=false){
 company=uuid.parse(company);
 const q=z.object({bucket:z.enum(['all','overdue','today','tomorrow','escalated','done','cancelled']).default('all'),page:z.coerce.number().int().min(0).max(100000).default(0),id:uuid.optional()}).parse(query);
 const s=await scope(sql,actor,company,platform);
 const data=(await sql.query(visible+`, matched AS(SELECT * FROM visible WHERE
 CASE $8::text WHEN 'done' THEN status='done' WHEN 'cancelled' THEN status='cancelled'
 WHEN 'overdue' THEN overdue WHEN 'escalated' THEN escalated
 WHEN 'today' THEN status='open' AND (due_at AT TIME ZONE $6::text)::date=(now() AT TIME ZONE $6::text)::date
 WHEN 'tomorrow' THEN status='open' AND (due_at AT TIME ZONE $6::text)::date=(now() AT TIME ZONE $6::text)::date+1
 ELSE status='open' END),
 page AS(SELECT id,customer_id,lead_id,full_name,title,due_at,status,assignee,version,repeat_kind,repeat_every,defer_count,last_defer_reason,predecessor_id,completed_at,can_write,overdue,escalated
 FROM matched ORDER BY due_at,id LIMIT 20 OFFSET $9::int)
 SELECT COALESCE((SELECT jsonb_agg(page ORDER BY due_at,id)FROM page),'[]'::jsonb) AS items,
 (SELECT count(*)::int FROM matched) AS total,
 (SELECT jsonb_build_object('open',count(*)FILTER(WHERE status='open'),'overdue',count(*)FILTER(WHERE overdue),'escalated',count(*)FILTER(WHERE escalated))FROM visible) AS counts`,[...s.params,q.bucket,q.page*20]))[0];
 let record=null,history:unknown[]=[];
 if(q.id){
  record=(await sql.query(visible+' SELECT * FROM visible WHERE id=$8::uuid',[...s.params,q.id]))[0];if(!record)throw new ServiceError('WORK_ITEM_UNAVAILABLE',404);
  history=await sql`SELECT id,action,actor_email,created_at,before_data->>'due_at' AS previous_due,after_data->>'due_at' AS next_due,after_data->>'reason' AS reason,after_data->>'next_follow_up_id' AS next_id FROM audit_logs WHERE company_id=${company} AND action IN('crm.follow_up_created','crm.follow_up_updated','crm.follow_up_postponed','crm.follow_up_recurrence_changed') AND after_data->>'id'=${q.id} ORDER BY created_at DESC,id DESC LIMIT 30`;
 }
 return {...data,record,history,time_zone:s.settings.time_zone,escalation_hours:s.settings.hours,as_of:s.settings.as_of,page:q.page,page_size:20,can_write:s.canWrite};
}
export async function changeFollowUp(sql:Sql,actor:Actor,raw:unknown,platform=false){
 const c=input.parse(raw),s=await scope(sql,actor,c.company_id,platform);
 if(!s.canWrite)throw new ServiceError('FORBIDDEN',403);
 let due:string|null=null;
 if(c.operation==='postpone'){
  const d=(await sql`SELECT (${c.due_local}::timestamp AT TIME ZONE ${s.settings.time_zone}::text) AS due,
  to_char((${c.due_local}::timestamp AT TIME ZONE ${s.settings.time_zone}::text) AT TIME ZONE ${s.settings.time_zone}::text,'YYYY-MM-DD"T"HH24:MI')=${c.due_local} AS valid,
  (${c.due_local}::timestamp AT TIME ZONE ${s.settings.time_zone}::text)>now() AS future`)[0];
  if(!d.valid||!d.future)throw new ServiceError('INVALID_FOLLOW_UP_DATE',400);due=d.due;
 }
 const version=c.version??null,kind=c.operation==='repeat'?c.repeat_kind:null,every=c.operation==='repeat'?c.repeat_every:null;
 const status=c.operation==='complete'?'done':c.operation==='cancel'?'cancelled':'open';
 const action=c.operation==='postpone'?'crm.follow_up_postponed':c.operation==='repeat'?'crm.follow_up_recurrence_changed':'crm.follow_up_updated';
 const rows=await sql.query(visible+`, previous AS MATERIALIZED(
 SELECT f.* FROM crm_follow_ups f WHERE f.company_id=$1::uuid AND f.id=$8::uuid AND f.status='open'
 AND ($9::int IS NULL OR f.version=$9::int) AND ($10::text<>'postpone' OR $12::timestamptz>f.due_at) AND EXISTS(SELECT 1 FROM visible v WHERE v.id=f.id AND v.can_write)
 AND ($10::text<>'complete' OR f.repeat_kind='none' OR EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=f.company_id AND m.user_id=f.assigned_to AND m.active)) FOR UPDATE
 ), changed AS(
 UPDATE crm_follow_ups f SET status=$11::text,version=f.version+1,
 completed_at=CASE WHEN $10::text='complete' THEN now() ELSE f.completed_at END,
 due_at=COALESCE($12::timestamptz,f.due_at),
 defer_count=f.defer_count+CASE WHEN $10::text='postpone' THEN 1 ELSE 0 END,
 last_defer_reason=CASE WHEN $10::text='postpone' THEN $13::text ELSE f.last_defer_reason END,
 repeat_kind=COALESCE($14::text,f.repeat_kind),repeat_every=COALESCE($15::int,f.repeat_every)
 WHERE f.company_id=$1::uuid AND f.id IN(SELECT id FROM previous) RETURNING f.*
 ), successor AS(
 INSERT INTO crm_follow_ups(company_id,customer_id,lead_id,due_at,title,assigned_to,created_by,repeat_kind,repeat_every,predecessor_id)
 SELECT company_id,customer_id,lead_id,
 (((GREATEST(due_at,now()) AT TIME ZONE $6::text)+
 CASE repeat_kind WHEN 'daily' THEN make_interval(days=>repeat_every) WHEN 'weekly' THEN make_interval(days=>7*repeat_every) ELSE make_interval(months=>repeat_every) END) AT TIME ZONE $6::text),
 title,assigned_to,created_by,repeat_kind,repeat_every,id FROM changed WHERE $10::text='complete' AND repeat_kind<>'none' RETURNING *
 ), logged AS(
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data)
 SELECT $1::uuid,$16::text,$17::text,$18::text,to_jsonb(previous),to_jsonb(changed)||jsonb_build_object('reason',$13::text,'next_follow_up_id',(SELECT id FROM successor))
 FROM previous JOIN changed USING(id)
 ), successor_log AS(
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 SELECT $1::uuid,$16::text,$17::text,'crm.follow_up_created',to_jsonb(successor) FROM successor)
 SELECT changed.id,changed.status,changed.version,(SELECT id FROM successor) AS next_follow_up_id FROM changed`,
 [...s.params,c.id,version,c.operation,status,due,c.reason,kind,every,actor.userId,actor.email,action]);
 if(!rows.length)throw new ServiceError('WORK_ITEM_UNAVAILABLE',409);
 return rows[0];
}
