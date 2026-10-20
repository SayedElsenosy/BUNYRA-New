import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {salesScope,projectAllowed} from './record-scope';

export async function offerScope(sql:Sql,actor:Actor,company:string,platform=false){
 const ctx=await access(sql,actor,company,'leads.read',platform),users=await salesScope(sql,actor,company,ctx);
 const projects=await sql`SELECT id FROM projects WHERE company_id=${company}`;
 const ids=projects.filter(p=>(['projects.read','inventory.read','pricing.read'] as const).every(a=>projectAllowed(ctx,a,p.id)&&projectAllowed(ctx,a))).map(p=>p.id);
 return {ctx,users,projects:ids};
}
export async function requireOffer(sql:Sql,actor:Actor,company:string,id:string,platform=false){
 uuid.parse(id);const scope=await offerScope(sql,actor,company,platform);
 const row=(await sql`SELECT *,quote_date::text AS issued_date FROM sales_offers WHERE company_id=${company} AND id=${id} AND status='ready' AND project_id=ANY(${scope.projects}::uuid[]) AND (${scope.users===null} OR created_by=ANY(${scope.users||[]}::text[]))`)[0];
 if(!row)throw new ServiceError('OFFER_UNAVAILABLE',404);return row;
}
export async function requireBuyerSource(sql:Sql,actor:Actor,company:string,request:string,customer:string,project:string,platform=false){
 uuid.parse(request);const ctx=await access(sql,actor,company,'leads.read',platform),users=await salesScope(sql,actor,company,ctx);
 const row=(await sql`SELECT id,customer_id,project_id,created_by FROM buyer_requests WHERE company_id=${company} AND id=${request} AND customer_id=${customer}`)[0];
 if(!row||(users&&!users.includes(row.created_by))||!projectAllowed(ctx,'leads.read',row.project_id)||(row.project_id&&row.project_id!==project))throw new ServiceError('INVALID_JOURNEY_SOURCE',403);
 return row;
}
