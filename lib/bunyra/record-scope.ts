import {access,ServiceError,type Sql,type Actor} from './service';
import {hasPermission,type Action} from './permissions';
export type AccessContext=Awaited<ReturnType<typeof access>>;
export function projectAllowed(ctx:AccessContext,action:Action,project?:string|null){return ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,action,project||undefined);}
export async function salesScope(sql:Sql,actor:Actor,company:string,ctx:AccessContext){
 if(ctx.owner||['company_admin','operations','finance_manager','accountant','sales_admin'].includes(ctx.role))return null;
 const users=[actor.userId];
 if(ctx.role==='sales_manager'){
 const members=await sql`SELECT DISTINCT m.user_id FROM crm_sales_team_members m JOIN crm_sales_teams t ON t.company_id=m.company_id AND t.id=m.team_id WHERE t.company_id=${company} AND t.manager_user_id=${actor.userId} AND t.active`;
 users.push(...members.map(m=>m.user_id as string));
 }return [...new Set(users)];
}
export async function bookingScope(sql:Sql,actor:Actor,company:string,action:Action,platform=false){
 const ctx=await access(sql,actor,company,action,platform),users=await salesScope(sql,actor,company,ctx);
 const records=await sql`SELECT id,project_id,sales_user_id,status FROM bookings WHERE company_id=${company}`;
 const ids=records.filter(b=>projectAllowed(ctx,action,b.project_id)&&(!users||users.includes(b.sales_user_id))).map(b=>b.id as string);
 return {ctx,ids};
}
export async function requireBooking(sql:Sql,actor:Actor,company:string,id:string,action:Action,platform=false){
 const scope=await bookingScope(sql,actor,company,action,platform);
 if(!scope.ids.includes(id))throw new ServiceError('FORBIDDEN',403);
 return (await sql`SELECT * FROM bookings WHERE company_id=${company} AND id=${id}`)[0];
}
export async function requireContract(sql:Sql,actor:Actor,company:string,id:string,action:Action,platform=false){
 await access(sql,actor,company,action,platform);
 const row=(await sql`SELECT * FROM contracts WHERE company_id=${company} AND id=${id}`)[0];
 if(!row)throw new ServiceError('NOT_FOUND',404);
 await requireBooking(sql,actor,company,row.booking_id,action,platform);return row;
}
