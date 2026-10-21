import { identity,json,failure } from '../../../lib/bunyra/http';
import { access } from '../../../lib/bunyra/service';
import {allowedCompanyViews} from '../../../lib/bunyra/workspace-navigation';
import { hasPermission } from '../../../lib/bunyra/permissions';
import {companySubscription} from '../../../lib/bunyra/subscriptions';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {sql,actor}=await identity();const id=new URL(request.url).searchParams.get('id')||'';
 const ctx=await access(sql,actor,id,'company.read');
 // Unfiltered on purpose: the bound tenant scope (RLS) limits rows to this company.
 const [companies,rows]=await sql.transaction([sql`SELECT id,name,name_en,email,phone,address FROM companies`,sql`SELECT id,name FROM projects ORDER BY name`]);
 if(!companies.length)return json({error:'FORBIDDEN'},403);
 const projects=rows.filter(p=>hasPermission(ctx.role,ctx.custom,ctx.overrides,'projects.read',p.id));
 const subscription=await companySubscription(sql,actor,id);
 const advanced=subscription.subscription===null||subscription.subscription.status!=='suspended'&&subscription.subscription.features?.advanced_reports===true;
 const allowed=allowedCompanyViews(ctx,rows.map(p=>String(p.id))).filter(v=>advanced||!['reports','deals-insights'].includes(v));
 return json({company:companies[0],projects,subscription:subscription.subscription?{status:subscription.subscription.status,seat_limit:subscription.subscription.seat_limit,project_limit:subscription.subscription.project_limit}:null,allowed_views:allowed,role:ctx.role,can_manage_members:hasPermission(ctx.role,ctx.custom,ctx.overrides,'accounts.manage')||hasPermission(ctx.role,ctx.custom,ctx.overrides,'members.manage')||hasPermission(ctx.role,ctx.custom,ctx.overrides,'roles.manage')});
 }catch(e){return failure(e);}}
