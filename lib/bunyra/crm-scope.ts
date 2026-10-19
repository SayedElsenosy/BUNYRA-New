import {access,ServiceError,type Sql,type Actor} from './service';
import {salesScope,projectAllowed} from './record-scope';
import type {Action} from './permissions';
export async function crmScope(sql:Sql,actor:Actor,company:string,action:Action='leads.read',platform=false){
 const ctx=await access(sql,actor,company,action,platform),users=await salesScope(sql,actor,company,ctx);
 const all=await sql`SELECT id,customer_id,owner_user_id,project_id,status,source,stage_id,created_at,updated_at FROM crm_leads WHERE company_id=${company}`;
 const leads=all.filter(l=>(!users||users.includes(l.owner_user_id))&&projectAllowed(ctx,action,l.project_id));
 const ids=leads.map(l=>l.id as string);
 const customers=await sql`SELECT id FROM crm_customers WHERE company_id=${company} `;
 return {ctx,users,leads,ids,customerIds:customers.map(c=>c.id as string)};
}
export async function requireLead(sql:Sql,actor:Actor,company:string,id:string,platform=false){
 const scope=await crmScope(sql,actor,company,'leads.write',platform);
 const row=scope.leads.find(l=>l.id===id);if(!row)throw new ServiceError('FORBIDDEN',403);return {...scope,row};
}
export async function requireCustomer(sql:Sql,actor:Actor,company:string,id:string,action:Action,platform=false){
 const scope=await crmScope(sql,actor,company,action,platform);if(!scope.customerIds.includes(id))throw new ServiceError('FORBIDDEN',403);return scope;
}
