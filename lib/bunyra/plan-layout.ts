import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {hasPermission} from './permissions';
import {writeAccess} from './plan-files';
const point=z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)]);
export const shapeSchema=z.object({unit_id:uuid,page:z.number().int().min(1).max(200),points:z.array(point).min(3).max(64)}).strict().refine(s=>Math.abs(s.points.reduce((a,p,i)=>{const q=s.points[(i+1)%s.points.length];return a+p[0]*q[1]-q[0]*p[1];},0))>0.000001,'Shape has no area');
export async function layoutAccess(sql:Sql,actor:Actor,company:string,project:string,file:string,platform=false){
 uuid.parse(file);const ctx=await access(sql,actor,company,'projects.read',platform,project);
 await access(sql,actor,company,'inventory.read',platform,project);
 const canWrite=(ctx.owner||['company_admin','operations'].includes(ctx.role))&&(ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'projects.write',project));
 const rows=await sql`SELECT f.id,f.title,f.building,f.floor,f.kind,f.status,coalesce(l.published,false) AS published,coalesce(l.version,0) AS layout_version FROM project_plan_files f LEFT JOIN plan_layouts l ON l.file_id=f.id AND l.company_id=f.company_id AND l.project_id=f.project_id WHERE f.company_id=${company} AND f.project_id=${project} AND f.id=${file} AND f.status='ready'`;
 if(!rows.length||(!canWrite&&!rows[0].published))throw new ServiceError('NOT_FOUND',404);
 return {canWrite,canPrice:ctx.owner||(['company_admin','operations'].includes(ctx.role)&&hasPermission(ctx.role,ctx.custom,ctx.overrides,'inventory.write',project)),canPublish:ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'plans.publish',project),file:rows[0]};
}
export async function getPlanLayout(sql:Sql,actor:Actor,company:string,project:string,file:string,platform=false){
 const ctx=await layoutAccess(sql,actor,company,project,file,platform);
 const shapes=await sql`SELECT unit_id,page,points FROM plan_unit_shapes WHERE company_id=${company} AND project_id=${project} AND file_id=${file} ORDER BY page,unit_id`;
 // Values come from inventory on every read, never a status/price copied into geometry.
 const units=await sql`SELECT u.id,u.code,u.building,u.floor,u.category,u.area::text,u.status,u.active,CASE WHEN ${ctx.canPrice} THEN u.proposed_price_minor::text ELSE NULL END AS proposed_price_minor,CASE WHEN ${ctx.canPrice} THEN u.details ELSE u.details-'price_per_sqm'-'out_price_per_sqm'-'source_div80'-'source_total_price' END AS details FROM inventory_units u WHERE u.company_id=${company} AND u.project_id=${project} AND (${ctx.canWrite} OR u.id IN(SELECT unit_id FROM plan_unit_shapes WHERE company_id=${company} AND project_id=${project} AND file_id=${file})) ORDER BY u.code LIMIT 5000`;
 return {file:ctx.file,version:ctx.file.layout_version,can_write:ctx.canWrite,can_publish:ctx.canPublish,shapes,units};
}
const saveSchema=z.object({company_id:uuid,project_id:uuid,file_id:uuid,version:z.number().int().min(0),published:z.boolean(),shapes:z.array(shapeSchema).max(1000)}).strict().refine(c=>new Set(c.shapes.map(s=>s.unit_id)).size===c.shapes.length,'Unit may only be mapped once per file');
export async function savePlanLayout(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=saveSchema.parse(input);await writeAccess(sql,actor,c.company_id,c.project_id,platform);
 const ctx=await layoutAccess(sql,actor,c.company_id,c.project_id,c.file_id,platform);
 if(ctx.file.layout_version!==c.version)throw new ServiceError('LAYOUT_CONFLICT',409);
 if(c.published||ctx.file.published)await access(sql,actor,c.company_id,'plans.publish',platform,c.project_id);
 const committed=await sql`SELECT s.unit_id,s.page,s.points FROM plan_unit_shapes s JOIN inventory_units u ON u.id=s.unit_id AND u.company_id=s.company_id AND u.project_id=s.project_id WHERE s.company_id=${c.company_id} AND s.project_id=${c.project_id} AND s.file_id=${c.file_id} AND u.status IN('pending','reserved','sold')`;
 for(const old of committed){const next=c.shapes.find(s=>s.unit_id===old.unit_id);if(!next||next.page!==old.page||JSON.stringify(next.points)!==JSON.stringify(old.points))throw new ServiceError('UNIT_GEOMETRY_LOCKED',409);}
 if(ctx.file.kind!=='pdf')throw new ServiceError('PDF_REQUIRED');
 if(c.published&&!c.shapes.length)throw new ServiceError('EMPTY_LAYOUT');
 const units=await sql`SELECT id FROM inventory_units WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND id IN(SELECT (value->>'unit_id')::uuid FROM jsonb_array_elements(${JSON.stringify(c.shapes)}::jsonb))`;
 if(units.length!==c.shapes.length)throw new ServiceError('INVALID_UNIT_SCOPE',400);
 // Immutable layout revisions are replaced atomically; a stale editor changes nothing.
 const rows=await sql.transaction([sql`SELECT id FROM projects WHERE id=${c.project_id} AND company_id=${c.company_id} FOR UPDATE`,sql`WITH previous AS(SELECT * FROM plan_layouts WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id}), changed AS(INSERT INTO plan_layouts(file_id,company_id,project_id,version,published,updated_by) SELECT ${c.file_id},${c.company_id},${c.project_id},1,${c.published},${actor.userId} WHERE (${c.version}=0 OR EXISTS(SELECT 1 FROM previous WHERE version=${c.version})) ON CONFLICT(file_id) DO UPDATE SET version=plan_layouts.version+1,published=EXCLUDED.published,updated_by=EXCLUDED.updated_by,updated_at=now() WHERE plan_layouts.company_id=${c.company_id} AND plan_layouts.project_id=${c.project_id} AND plan_layouts.version=${c.version} RETURNING *), removed AS(DELETE FROM plan_unit_shapes WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id} AND EXISTS(SELECT 1 FROM changed) RETURNING unit_id), added AS(INSERT INTO plan_unit_shapes(company_id,project_id,file_id,unit_id,page,points) SELECT ${c.company_id},${c.project_id},${c.file_id},r.unit_id,r.page,r.points FROM jsonb_to_recordset(${JSON.stringify(c.shapes)}::jsonb) AS r(unit_id uuid,page integer,points jsonb) CROSS JOIN changed CROSS JOIN (SELECT count(*) FROM removed) done RETURNING unit_id), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'project.layout_saved',jsonb_build_object('version',${c.version}::int,'shapes',(SELECT jsonb_agg(to_jsonb(s)) FROM plan_unit_shapes s WHERE s.company_id=${c.company_id} AND s.project_id=${c.project_id} AND s.file_id=${c.file_id})) ,jsonb_build_object('file_id',${c.file_id}::uuid,'version',changed.version,'published',changed.published,'shapes',${JSON.stringify(c.shapes)}::jsonb) FROM changed) SELECT version FROM changed`]);
 if(!rows[1].length)throw new ServiceError('LAYOUT_CONFLICT',409);return {ok:true,version:rows[1][0].version};
}
