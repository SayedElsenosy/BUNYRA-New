import {z} from 'zod';
import {ServiceError,type Sql,type Actor,uuid} from './service';
import {workspaceTaskContext,workspaceTaskSql} from './workspace-hub';

export const alertQuery=z.object({
 company:uuid,
 bucket:z.enum(['all','unread','overdue','today','tomorrow','waiting']).default('all'),
 page:z.coerce.number().int().min(0).max(10000).default(0)
}).strict();

export const readInput=z.object({
 company_id:uuid,kind:z.enum(['follow_up','booking_approval','receipt_confirmation','installment']),
 id:uuid,operation:z.literal('read')
}).strict();

/** A task alert reappears as unread if its due date, context or urgency bucket changes.
 * Records disappear from the active inbox when underlying work is completed. */
export const signatureSql=`md5(concat_ws('|',t.kind,t.id::text,
  COALESCE(t.title,''),COALESCE(t.context,''),COALESCE(t.due_at::text,''),
  COALESCE(t.bucket,'')))`;

const visible=workspaceTaskSql+`, alerts AS (
 SELECT t.*, ${signatureSql} AS signature,
  (r.signature IS NOT NULL AND r.signature=${signatureSql}) AS is_read
 FROM tasks t LEFT JOIN workspace_alert_reads r
 ON r.company_id=$1::uuid AND r.user_id=$16::text AND r.kind=t.kind AND r.source_id=t.id
)`;

export async function workspaceAlerts(sql:Sql,actor:Actor,input:unknown,platform=false){
 const q=alertQuery.parse(input),scope=await workspaceTaskContext(sql,actor,q.company,platform);
 const params=[...scope.params,actor.userId,q.bucket,q.page*20];
 const data=(await sql.query(visible+`
 SELECT
 (SELECT count(*)::int FROM alerts) AS total,
 (SELECT count(*)::int FROM alerts WHERE NOT is_read) AS unread,
 (SELECT count(*)::int FROM alerts WHERE bucket='overdue') AS overdue,
 (SELECT count(*)::int FROM alerts WHERE bucket='today') AS today,
 (SELECT count(*)::int FROM alerts WHERE bucket='waiting') AS waiting,
 (SELECT count(*)::int FROM alerts WHERE ($17='all' OR ($17='unread' AND NOT is_read) OR bucket=$17)) AS filtered_total,
 (SELECT COALESCE(jsonb_agg(x ORDER BY x.priority,x.due_at NULLS LAST,x.created_at,x.id),'[]'::jsonb) FROM (
   SELECT id,kind,title,context,due_at,created_at,assignee,assignee_id,
     bucket,view,record_id,is_read,signature,
     CASE bucket WHEN 'overdue' THEN 0 WHEN 'today' THEN 1 WHEN 'waiting' THEN 2 WHEN 'tomorrow' THEN 3 ELSE 4 END AS priority
   FROM alerts
   WHERE ($17='all' OR ($17='unread' AND NOT is_read) OR bucket=$17)
   ORDER BY priority,due_at NULLS LAST,created_at,id,kind
   LIMIT 20 OFFSET $18::int
 ) x) AS items
 `,params))[0];
 return {...data,page:q.page,page_size:20,as_of:scope.now,time_zone:scope.timeZone};
}

export async function readWorkspaceAlert(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=readInput.parse(input),scope=await workspaceTaskContext(sql,actor,c.company_id,platform);
 const rows=await sql.query(workspaceTaskSql+`, chosen AS(
 SELECT t.kind,t.id,${signatureSql} AS signature FROM tasks t
 WHERE t.kind=$16::text AND t.id=$17::uuid
 ), recorded AS(
 INSERT INTO workspace_alert_reads(company_id,user_id,kind,source_id,signature)
 SELECT $1::uuid,$18::text,kind,id,signature FROM chosen
 ON CONFLICT(company_id,user_id,kind,source_id)
 DO UPDATE SET signature=EXCLUDED.signature,read_at=now()
 RETURNING source_id,kind,read_at
 )
 SELECT source_id,kind,read_at FROM recorded`,
 [...scope.params,c.kind,c.id,actor.userId]);
 if(!rows.length)throw new ServiceError('WORK_ITEM_UNAVAILABLE',404);
 return rows[0];
}
