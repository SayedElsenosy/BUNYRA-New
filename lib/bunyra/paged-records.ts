import "server-only";
import {access,ServiceError,uuid,type Sql,type Actor} from "./service";
import {projectAllowed,salesScope} from "./record-scope";
type Kind="customers"|"contracts"|"receipts";
export async function pagedRecords(sql:Sql,actor:Actor,company:string,kind:Kind,options:{
 page?:string;search?:string;platform?:boolean;
}={}){
 uuid.parse(company);
 const page=Math.min(10000,Math.max(1,Number.parseInt(options.page||"1",10)||1));
 const limit=20,offset=(page-1)*limit;
 const search=(options.search??"").trim().slice(0,120);
 const pattern="%"+search.replace(/[\\%_]/g,"\\$&")+"%";
 if(kind==="customers"){
  await access(sql,actor,company,"leads.read",options.platform);
  const [total]=await sql`SELECT count(*)::int AS n FROM crm_customers
    WHERE company_id=${company} AND (${search}='' OR full_name ILIKE ${pattern} OR phone ILIKE ${pattern}
      OR email ILIKE ${pattern})`;
  const rows=await sql`SELECT id,full_name,phone AS phone_primary,email,national_id,updated_at
    FROM crm_customers WHERE company_id=${company} AND (${search}='' OR full_name ILIKE ${pattern}
    OR phone ILIKE ${pattern} OR email ILIKE ${pattern})
    ORDER BY updated_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`;
  return {rows,total:Number(total.n),page,limit,search};
 }
 const permission=kind==="receipts"?"finance.read":"bookings.read";
 const ctx=await access(sql,actor,company,permission,options.platform);
 const projectRows=await sql`SELECT id FROM projects WHERE company_id=${company}`;
 const projectIds=projectRows.filter(p=>projectAllowed(ctx,permission,p.id)).map(p=>p.id as string);
 const users=await salesScope(sql,actor,company,ctx);
 if(!projectIds.length)return {rows:[],total:0,page,limit,search};
 if(kind==="contracts"){
  const [total]=await sql`SELECT count(*)::int AS n FROM contracts c
    JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
    WHERE c.company_id=${company} AND c.project_id=ANY(${projectIds}::uuid[])
    AND (${users}::text[] IS NULL OR b.sales_user_id=ANY(${users||[]}::text[]))
    AND (${search}='' OR c.contract_number ILIKE ${pattern} OR b.customer_name ILIKE ${pattern})`;
  const rows=await sql`SELECT c.id,c.contract_number,c.status,c.signed_at,c.value_final_minor::text,
    b.customer_name,u.code AS unit_code
    FROM contracts c JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
    JOIN inventory_units u ON u.company_id=c.company_id AND u.id=c.unit_id
    WHERE c.company_id=${company} AND c.project_id=ANY(${projectIds}::uuid[])
    AND (${users}::text[] IS NULL OR b.sales_user_id=ANY(${users||[]}::text[]))
    AND (${search}='' OR c.contract_number ILIKE ${pattern} OR b.customer_name ILIKE ${pattern})
    ORDER BY c.signed_at DESC,c.id DESC LIMIT ${limit} OFFSET ${offset}`;
  return {rows,total:Number(total.n),page,limit,search};
 }
 const [total]=await sql`SELECT count(*)::int AS n FROM receipts r
  JOIN contracts c ON c.company_id=r.company_id AND c.id=r.contract_id
  JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
  WHERE r.company_id=${company} AND c.project_id=ANY(${projectIds}::uuid[])
   AND (${users}::text[] IS NULL OR b.sales_user_id=ANY(${users||[]}::text[]))
   AND (${search}='' OR r.reference_number ILIKE ${pattern} OR b.customer_name ILIKE ${pattern}
    OR c.contract_number ILIKE ${pattern})`;
 const rows=await sql`SELECT r.id,r.contract_id,r.amount_minor::text,r.method,r.reference_number,r.created_at,
   c.contract_number,b.customer_name FROM receipts r
   JOIN contracts c ON c.company_id=r.company_id AND c.id=r.contract_id
   JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
   WHERE r.company_id=${company} AND c.project_id=ANY(${projectIds}::uuid[])
   AND (${users}::text[] IS NULL OR b.sales_user_id=ANY(${users||[]}::text[]))
   AND (${search}='' OR r.reference_number ILIKE ${pattern} OR b.customer_name ILIKE ${pattern}
    OR c.contract_number ILIKE ${pattern})
   ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit} OFFSET ${offset}`;
 return {rows,total:Number(total.n),page,limit,search};
}
