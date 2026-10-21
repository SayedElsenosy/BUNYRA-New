import {z} from 'zod';
import {crmScope} from './crm-scope';
import {projectAllowed} from './record-scope';
import {type Sql,type Actor,ServiceError,uuid} from './service';

const queryInput=z.object({stage:z.union([uuid,z.literal('unassigned')]).optional(),page:z.coerce.number().int().min(1).max(100000).default(1)});
export async function pipelineBoard(sql:Sql,actor:Actor,company:string,input:unknown={},platform=false){
 const q=queryInput.parse(input),scope=await crmScope(sql,actor,company,'leads.read',platform);
 let writable=new Set<string>();
 try{const w=await crmScope(sql,actor,company,'leads.write',platform);writable=new Set(w.leads.filter(l=>projectAllowed(w.ctx,'leads.write',l.project_id)&&(w.ctx.owner||['company_admin','sales_manager','sales_admin','operations'].includes(w.ctx.role)||l.owner_user_id===actor.userId)).map(l=>l.id));}catch(e){if(!(e instanceof ServiceError)||e.status!==403)throw e;}
 const rows=await sql`WITH buckets AS(
  SELECT s.id::text AS key,s.id,s.name,s.name_en,s.position,s.active FROM crm_pipeline_stages s WHERE s.company_id=${company}
  UNION ALL SELECT 'unassigned',NULL::uuid,'بدون مرحلة','Unassigned',-1,false
 ), scoped AS(
  SELECT l.*,c.full_name,COALESCE(m.email,l.owner_user_id) AS owner_name,
    floor(GREATEST(0,EXTRACT(EPOCH FROM (now()-COALESCE(h.entered_at,l.created_at)))/86400))::int AS stage_days
  FROM crm_leads l JOIN crm_customers c ON c.company_id=l.company_id AND c.id=l.customer_id
  LEFT JOIN memberships m ON m.company_id=l.company_id AND m.user_id=l.owner_user_id
  LEFT JOIN LATERAL(SELECT x.created_at AS entered_at FROM audit_logs x WHERE x.company_id=l.company_id
   AND x.action='crm.lead_stage_changed' AND COALESCE(x.after_data->>'id',x.after_data->>'lead_id')=l.id::text ORDER BY x.created_at DESC,x.id DESC LIMIT 1)h ON true
  WHERE l.company_id=${company} AND l.id=ANY(${scope.ids}::uuid[])
 ), numbered AS(SELECT *,row_number()OVER(PARTITION BY stage_id ORDER BY updated_at DESC,id) AS rn FROM scoped)
 SELECT b.*, (SELECT count(*)::int FROM scoped l WHERE l.stage_id IS NOT DISTINCT FROM b.id) AS total,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'customer_id',l.customer_id,'full_name',l.full_name,
 'owner_name',l.owner_name,'stage_id',l.stage_id,'status',l.status,'source',l.source,'version',l.version,'stage_days',l.stage_days) ORDER BY l.rn)
 FROM numbered l WHERE l.stage_id IS NOT DISTINCT FROM b.id AND l.rn>${(q.page-1)*25} AND l.rn<=${q.page*25}),'[]'::jsonb) AS leads
 FROM buckets b WHERE (${q.stage??null}::text IS NULL OR b.key=${q.stage??null}::text) ORDER BY b.position,b.key`;
 if(q.stage&&!rows.length)throw new ServiceError('INVALID_STAGE',400);
 const columns=rows.filter(r=>r.active||r.total>0||q.stage===r.key).map(r=>({...r,total:Number(r.total),page:q.page,leads:r.leads.map((l:{id:string})=>({...l,can_move:writable.has(l.id)}))}));
 return {columns,page_size:25,total:columns.reduce((n,r)=>n+Number(r.total),0)};
}
