import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {hasPermission} from './permissions';
import {writeAccess} from './plan-files';
import {simplePolygon,geometryIssue,type Shape} from './plan-geometry';
const point=z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)]);
export const shapeSchema=z.object({unit_id:uuid.transform(s=>s.toLowerCase()),page:z.number().int().min(1).max(200),points:z.array(point).min(3).max(64)}).strict().refine(s=>simplePolygon(s.points),'INVALID_BOUNDARY');
export async function layoutAccess(sql:Sql,actor:Actor,company:string,project:string,file:string,platform=false){
 uuid.parse(file);const ctx=await access(sql,actor,company,'projects.read',platform,project);await access(sql,actor,company,'inventory.read',platform,project);
 const manager=ctx.owner||['company_admin','operations'].includes(ctx.role);const canWrite=manager&&(ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'projects.write',project)),canPublish=manager&&(ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'plans.publish',project));
 const rows=await sql`SELECT f.id,f.title,f.building,f.floor,f.kind,f.status,coalesce(l.published,false) AS published,coalesce(l.version,0) AS layout_version,l.draft_revision_id,l.published_revision_id FROM project_plan_files f LEFT JOIN plan_layouts l ON l.file_id=f.id AND l.company_id=f.company_id AND l.project_id=f.project_id WHERE f.company_id=${company} AND f.project_id=${project} AND f.id=${file} AND f.status='ready'`;
 if(!rows.length||(!canWrite&&!canPublish&&!rows[0].published))throw new ServiceError('NOT_FOUND',404);
 return {canWrite,canPublish,canPrice:ctx.owner||(['company_admin','operations'].includes(ctx.role)&&hasPermission(ctx.role,ctx.custom,ctx.overrides,'inventory.write',project)),file:rows[0]};
}
export async function getPlanLayout(sql:Sql,actor:Actor,company:string,project:string,file:string,platform=false,view?:string){
 const ctx=await layoutAccess(sql,actor,company,project,file,platform),reviewer=ctx.canWrite||ctx.canPublish;
 const id=view==='published'?ctx.file.published_revision_id:view==='draft'?(reviewer?ctx.file.draft_revision_id:null):view?uuid.parse(view):(reviewer?ctx.file.draft_revision_id||ctx.file.published_revision_id:ctx.file.published_revision_id);
 if(view==='draft'&&!reviewer)throw new ServiceError('NOT_FOUND',404);
 const revision=id?(await sql`SELECT id,version,state,reason,shapes,created_by,created_at,approved_by,approved_at FROM plan_layout_revisions WHERE company_id=${company} AND project_id=${project} AND file_id=${file} AND id=${id}`)[0]:null;
 if(id&&!revision)throw new ServiceError('NOT_FOUND',404);
 const history=await sql`SELECT id,version,state,reason,created_by,created_at,approved_by,approved_at,jsonb_array_length(shapes) AS units_count FROM plan_layout_revisions WHERE company_id=${company} AND project_id=${project} AND file_id=${file} AND (${reviewer} OR state='approved') ORDER BY version DESC LIMIT 100`;
 const baseline=reviewer&&ctx.file.published_revision_id?(await sql`SELECT shapes FROM plan_layout_revisions WHERE company_id=${company} AND project_id=${project} AND file_id=${file} AND id=${ctx.file.published_revision_id}`)[0]?.shapes||[]:[];
 // Geometry revisions never overwrite live inventory values or approved price snapshots.
 const units=await sql`SELECT u.id,u.code,u.building,u.floor,u.category,u.area::text,u.status,u.active,CASE WHEN ${ctx.canPrice} THEN u.proposed_price_minor::text ELSE NULL END AS proposed_price_minor,CASE WHEN ${ctx.canPrice} THEN u.details ELSE u.details-'price_per_sqm'-'out_price_per_sqm'-'source_div80'-'source_total_price' END AS details FROM inventory_units u WHERE u.company_id=${company} AND u.project_id=${project} ORDER BY u.code LIMIT 5000`;
 const safeFile=reviewer?ctx.file:{...ctx.file,draft_revision_id:null};return {file:safeFile,version:ctx.file.layout_version,can_write:ctx.canWrite,can_publish:ctx.canPublish,revision,history,baseline,shapes:revision?.shapes||[],units};
}
const saveSchema=z.object({company_id:uuid,project_id:uuid,file_id:uuid,version:z.number().int().min(0),published:z.literal(false).optional(),reason:z.string().trim().min(3).max(500),shapes:z.array(shapeSchema).max(1000)}).strict().refine(c=>new Set(c.shapes.map(s=>s.unit_id)).size===c.shapes.length,'DUPLICATE_UNIT_MAPPING');
function checkGeometry(shapes:Shape[]){const issue=geometryIssue(shapes);if(issue)throw new ServiceError(issue.code,400);}
export async function savePlanLayout(sql:Sql,actor:Actor,input:unknown,platform=false){
 if((input as {published?:boolean})?.published===true)throw new ServiceError('LAYOUT_APPROVAL_REQUIRED',409);
 const c=saveSchema.parse(input);await writeAccess(sql,actor,c.company_id,c.project_id,platform);const ctx=await layoutAccess(sql,actor,c.company_id,c.project_id,c.file_id,platform);
 if(ctx.file.layout_version!==c.version)throw new ServiceError('LAYOUT_CONFLICT',409);if(ctx.file.kind!=='pdf')throw new ServiceError('PDF_REQUIRED');checkGeometry(c.shapes);
 const ids=c.shapes.map(s=>s.unit_id),units=await sql`SELECT id,version FROM inventory_units WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND id IN(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`;
 if(units.length!==c.shapes.length)throw new ServiceError('INVALID_UNIT_SCOPE',400);
 const id=crypto.randomUUID(),shapes=JSON.stringify(c.shapes),versions=JSON.stringify(Object.fromEntries(units.map(u=>[u.id,u.version])));
 const r=await sql.transaction([
 sql`SELECT id FROM projects WHERE id=${c.project_id} AND company_id=${c.company_id} FOR UPDATE`,
 sql`SELECT bunyra_pricing_assert(coalesce((SELECT version FROM plan_layouts WHERE file_id=${c.file_id} AND company_id=${c.company_id} AND project_id=${c.project_id}),0)=${c.version},'LAYOUT_CONFLICT')`,
 sql`INSERT INTO plan_layouts(file_id,company_id,project_id,version,published,updated_by) VALUES(${c.file_id},${c.company_id},${c.project_id},1,false,${actor.userId}) ON CONFLICT(file_id) DO NOTHING`,
 sql`INSERT INTO plan_layout_revisions(id,company_id,project_id,file_id,version,reason,shapes,unit_versions,created_by) VALUES(${id},${c.company_id},${c.project_id},${c.file_id},${c.version+1},${c.reason},${shapes}::jsonb,${versions}::jsonb,${actor.userId})`,
 sql`UPDATE plan_layouts SET version=${c.version+1},draft_revision_id=${id},updated_by=${actor.userId},updated_at=now() WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id} RETURNING version`,
 sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'project.layout_draft_saved',${JSON.stringify({version:c.version,published_revision_id:ctx.file.published_revision_id})}::jsonb,${JSON.stringify({file_id:c.file_id,revision_id:id,version:c.version+1,reason:c.reason,shapes:c.shapes})}::jsonb)`
 ]);return {ok:true,version:r[4][0].version,revision_id:id};
}
const approvalSchema=z.object({company_id:uuid,project_id:uuid,file_id:uuid,version:z.number().int().positive(),revision_id:uuid}).strict();
export async function approvePlanLayout(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=approvalSchema.parse(input),ctx=await layoutAccess(sql,actor,c.company_id,c.project_id,c.file_id,platform);await access(sql,actor,c.company_id,'plans.publish',platform,c.project_id);if(!ctx.canPublish)throw new ServiceError('FORBIDDEN',403);
 const revision=(await sql`SELECT shapes,unit_versions FROM plan_layout_revisions WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id} AND id=${c.revision_id} AND state='draft'`)[0];if(!revision)throw new ServiceError('LAYOUT_CONFLICT',409);
 const shapes=z.array(shapeSchema).parse(revision.shapes);if(!shapes.length)throw new ServiceError('EMPTY_LAYOUT',400);checkGeometry(shapes);
 const payload=JSON.stringify(shapes),versions=JSON.stringify(revision.unit_versions);
 const r=await sql.transaction([
 sql`SELECT id FROM projects WHERE id=${c.project_id} AND company_id=${c.company_id} FOR UPDATE`,
 sql`SELECT id FROM inventory_units WHERE company_id=${c.company_id} AND project_id=${c.project_id} ORDER BY id FOR UPDATE`,
 sql`SELECT bunyra_pricing_assert(EXISTS(SELECT 1 FROM plan_layouts WHERE file_id=${c.file_id} AND company_id=${c.company_id} AND project_id=${c.project_id} AND version=${c.version} AND draft_revision_id=${c.revision_id}),'LAYOUT_CONFLICT')`,
 sql`SELECT bunyra_pricing_assert((SELECT count(*) FROM jsonb_each_text(${versions}::jsonb) v JOIN inventory_units u ON u.id=v.key::uuid AND u.company_id=${c.company_id} AND u.project_id=${c.project_id} AND u.version=v.value::int)=${shapes.length},'LAYOUT_SOURCE_CHANGED')`,
 sql`SELECT bunyra_pricing_assert(NOT EXISTS(SELECT 1 FROM inventory_units u LEFT JOIN plan_unit_shapes old ON old.unit_id=u.id AND old.company_id=u.company_id AND old.project_id=u.project_id AND old.file_id=${c.file_id} LEFT JOIN jsonb_to_recordset(${payload}::jsonb) n(unit_id uuid,page integer,points jsonb) ON n.unit_id=u.id WHERE u.company_id=${c.company_id} AND u.project_id=${c.project_id} AND u.status IN('pending','reserved','sold') AND (old.unit_id IS NOT NULL OR n.unit_id IS NOT NULL) AND (old.page IS DISTINCT FROM n.page OR old.points IS DISTINCT FROM n.points)),'UNIT_GEOMETRY_LOCKED')`,
 sql`UPDATE plan_layout_revisions SET state='approved',approved_by=${actor.userId},approved_at=now() WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id} AND id=${c.revision_id} AND state='draft' RETURNING id`,
 sql`DELETE FROM plan_unit_shapes WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id}`,
 sql`INSERT INTO plan_unit_shapes(company_id,project_id,file_id,unit_id,page,points) SELECT ${c.company_id},${c.project_id},${c.file_id},r.unit_id,r.page,r.points FROM jsonb_to_recordset(${payload}::jsonb) r(unit_id uuid,page integer,points jsonb)`,
 sql`WITH previous AS MATERIALIZED(SELECT published_revision_id,version FROM plan_layouts WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id}),changed AS(UPDATE plan_layouts SET published=true,published_revision_id=${c.revision_id},draft_revision_id=NULL,version=version+1,updated_by=${actor.userId},updated_at=now() WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id} RETURNING version),logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'project.layout_approved',(SELECT to_jsonb(previous) FROM previous),jsonb_build_object('file_id',${c.file_id}::uuid,'revision_id',${c.revision_id}::uuid,'version',changed.version) FROM changed RETURNING id) SELECT version FROM changed`
 ]);return {ok:true,version:r[8][0].version,revision_id:c.revision_id};
}
