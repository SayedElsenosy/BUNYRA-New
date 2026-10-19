import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {layoutAccess,shapeSchema} from './plan-layout';
import {geometryIssue,type Shape} from './plan-geometry';
import {sameCoverage} from './unit-transform-geometry';
const output=z.object({id:uuid,code:z.string().trim().min(1).max(100),area:z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).refine(v=>Number(v)>0),points:z.array(z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)])).min(3).max(64)}).strict();
const inputSchema=z.object({company_id:uuid,project_id:uuid,file_id:uuid,version:z.number().int().min(0),reason:z.string().trim().min(3).max(500),operation:z.enum(['split','merge']),source_ids:z.array(uuid).min(1).max(10),outputs:z.array(output).min(1).max(10)}).strict();
export async function saveUnitTransformation(sql:Sql,actor:Actor,input:unknown,platform=false){
 const c=inputSchema.parse(input);await access(sql,actor,c.company_id,'inventory.write',platform,c.project_id);
 const ctx=await layoutAccess(sql,actor,c.company_id,c.project_id,c.file_id,platform);await access(sql,actor,c.company_id,'projects.write',platform,c.project_id);
 if(!ctx.canWrite||!ctx.canPrice)throw new ServiceError('FORBIDDEN',403);
 if(ctx.file.layout_version!==c.version||ctx.file.draft_revision_id)throw new ServiceError('LAYOUT_CONFLICT',409);
 if(!ctx.file.published_revision_id)throw new ServiceError('APPROVED_LAYOUT_REQUIRED',409);
 if(new Set(c.source_ids).size!==c.source_ids.length||new Set(c.outputs.map(o=>o.code.toLowerCase())).size!==c.outputs.length||new Set(c.outputs.map(o=>o.id)).size!==c.outputs.length)throw new ServiceError('DUPLICATE_UNIT',400);
 if(c.operation==='split'?(c.source_ids.length!==1||c.outputs.length<2):(c.source_ids.length<2||c.outputs.length!==1))throw new ServiceError('INVALID_TRANSFORMATION',400);
 const sources=await sql`SELECT * FROM inventory_units WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND id=ANY(${c.source_ids}::uuid[])`;
 if(sources.length!==c.source_ids.length||sources.some(u=>!u.active||u.status!=='available'))throw new ServiceError('UNIT_COMMITTED',409);
 if(new Set(sources.map(u=>u.building+'|'+u.floor+'|'+u.category)).size!==1)throw new ServiceError('UNIT_SCOPE_MISMATCH',400);
 const current=(await sql`SELECT shapes FROM plan_layout_revisions WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id} AND id=${ctx.file.published_revision_id}`)[0].shapes as Shape[];
 const before=current.filter(s=>c.source_ids.includes(s.unit_id));
 if(before.length!==sources.length||new Set(before.map(s=>s.page)).size!==1)throw new ServiceError('SAME_PAGE_REQUIRED',400);
 const after=c.outputs.map(o=>({unit_id:o.id,page:before[0].page,points:o.points})),shapes=[...current.filter(s=>!c.source_ids.includes(s.unit_id)),...after];
 const issue=geometryIssue(shapes);if(issue)throw new ServiceError(issue.code,400);
 if(!sameCoverage(before,after))throw new ServiceError('BOUNDARY_COVERAGE_MISMATCH',400);
 const units=await sql`SELECT id,version FROM inventory_units WHERE company_id=${c.company_id} AND project_id=${c.project_id}`;
 if(c.outputs.some(o=>units.some(u=>u.id===o.id)))throw new ServiceError('DUPLICATE_UNIT',400);
 const versions=Object.fromEntries(shapes.map(s=>[s.unit_id,units.find(u=>u.id===s.unit_id)?.version||1]));
 const id=crypto.randomUUID(),change={operation:c.operation,source_ids:c.source_ids,source_versions:Object.fromEntries(sources.map(u=>[u.id,u.version])),outputs:c.outputs.map(o=>({...o,building:sources[0].building,floor:sources[0].floor,category:sources[0].category,details:{}}))};
 const r=await sql.transaction([
 sql`SELECT id FROM projects WHERE company_id=${c.company_id} AND id=${c.project_id} FOR UPDATE`,
 sql`SELECT bunyra_pricing_assert(EXISTS(SELECT 1 FROM plan_layouts WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id} AND version=${c.version} AND draft_revision_id IS NULL),'LAYOUT_CONFLICT')`,
 sql`INSERT INTO plan_layout_revisions(id,company_id,project_id,file_id,version,reason,shapes,unit_versions,created_by,inventory_change) VALUES(${id},${c.company_id},${c.project_id},${c.file_id},${c.version+1},${c.reason},${JSON.stringify(shapes)}::jsonb,${JSON.stringify(versions)}::jsonb,${actor.userId},${JSON.stringify(change)}::jsonb)`,
 sql`UPDATE plan_layouts SET draft_revision_id=${id},version=version+1,updated_by=${actor.userId},updated_at=now() WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND file_id=${c.file_id} RETURNING version`,
 sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'inventory.transformation_drafted',${JSON.stringify({revision_id:id,...change})}::jsonb)`
 ]);return {revision_id:id,version:r[3][0].version};
}
