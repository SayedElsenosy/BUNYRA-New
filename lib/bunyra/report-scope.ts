import {access,ServiceError,type Sql,type Actor} from './service';
import {projectAllowed,salesScope} from './record-scope';
import type {Action} from './permissions';
export async function reportScope(sql:Sql,actor:Actor,company:string,action:Action,platform=false){
 const ctx=await access(sql,actor,company,action,platform),users=ctx.role==='sales_admin'&&!ctx.owner?[actor.userId]:await salesScope(sql,actor,company,ctx);
 const projects=(await sql`SELECT id,name FROM projects WHERE company_id=${company} ORDER BY name`).filter(p=>projectAllowed(ctx,action,p.id));
 const members=(await sql`SELECT user_id,email,active FROM memberships WHERE company_id=${company} ORDER BY email`).filter(m=>!users||users.includes(m.user_id));
 return {ctx,users,projects,members};
}
export function scopeFilters(scope:Awaited<ReturnType<typeof reportScope>>,project?:string,user?:string){
 if(project&&!scope.projects.some(p=>p.id===project))throw new ServiceError('FORBIDDEN',403);
 if(user&&scope.users&&!scope.users.includes(user))throw new ServiceError('FORBIDDEN',403);
 return {projects:project?[project]:scope.projects.map(p=>p.id as string),users:user?[user]:scope.users};
}
export const dateValue=(v:string)=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
