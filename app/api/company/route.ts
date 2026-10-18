import { identity,json,failure } from '../../../lib/bunyra/http';
import { access } from '../../../lib/bunyra/service';
import { hasPermission } from '../../../lib/bunyra/permissions';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {sql,actor}=await identity();const id=new URL(request.url).searchParams.get('id')||'';
 const ctx=await access(sql,actor,id,'company.read');
 const results=await sql.transaction([sql`SET LOCAL ROLE bunyra_tenant`,sql`SELECT set_config('app.company_id',${id},true),set_config('app.user_id',${actor.userId},true)`,sql`SELECT id,name,name_en,email,phone,address FROM companies`,sql`SELECT id,name FROM projects ORDER BY name`]);
 if(!results[2].length)return json({error:'FORBIDDEN'},403);
 const projects=results[3].filter(p=>hasPermission(ctx.role,ctx.custom,ctx.overrides,'projects.read',p.id));
 return json({company:results[2][0],projects,can_manage_members:hasPermission(ctx.role,ctx.custom,ctx.overrides,'members.manage')||hasPermission(ctx.role,ctx.custom,ctx.overrides,'roles.manage')});
 }catch(e){return failure(e);}}
