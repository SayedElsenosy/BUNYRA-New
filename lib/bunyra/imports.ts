import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {unitSchema} from './inventory';
import {minorUnits} from './projects';
import {detailValues,DETAIL_FIELDS} from './unit-fields';
export {IMPORT_FIELDS} from './import-format';
const importUnitSchema=unitSchema.extend({status:z.enum(['available','unavailable','pending','reserved','sold'])});
export type ImportRow=Record<string,unknown>;
export function normalizeCell(value:unknown){return String(value??'').trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/٫/g,'.');}
function decimal(value:unknown){const s=normalizeCell(value);return /^\d{1,3}(?:[,٬]\d{3})+(?:\.\d{1,2})?$/.test(s)?s.replace(/[,٬]/g,''):s;}
// Round cached Excel formula decimals to currency cents using integer arithmetic.
// Preserve the complete source string separately; never recalculate Total Price from rate columns.
export function currencyCell(value:unknown){const s=decimal(value);if(!/^\d{1,12}(\.\d+)?$/.test(s))return s;const [whole,fraction='']=s.split('.');let cents=BigInt(whole)*BigInt(100)+BigInt((fraction+'00').slice(0,2));if((fraction[2]||'0')>='5')cents+=BigInt(1);const raw=cents.toString().padStart(3,'0');return raw.slice(0,-2)+'.'+raw.slice(-2);}
export function validateImportRows(company:string,project:string,rows:ImportRow[],sourceRows?:number[]){
 const errors:{row:number;field:string;code:string;value?:string}[]=[],warnings:{row:number;field:string;code:string;value:string;normalized:string}[]=[],units:z.infer<typeof importUnitSchema>[]=[];
 const seen=new Set<string>();
 rows.forEach((row,index)=>{
  const statusValue=normalizeCell(row.status).toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' '),activeValue=normalizeCell(row.active).toLowerCase();
  const statuses:Record<string,string[]>={available:['','available','متاحة','متاح'],unavailable:['unavailable','not available','غير متاحة','غير متاح','cancelled','canceled','block','blocked','ملغاة','ملغي'],pending:['pending','pending reservation','قيد الحجز'],reserved:['reserved','reservation','booked','محجوزة','محجوز'],sold:['sold','sold out','مباعة','مباع']};
  const status=Object.keys(statuses).find(k=>statuses[k].includes(statusValue))??statusValue;
  const active=['','true','1','نعم','مفعلة','active'].includes(activeValue)?true:['false','0','لا','موقوفة','inactive'].includes(activeValue)?false:activeValue;
  const price=currencyCell(row.proposed_price),sourcePrice=normalizeCell(row.proposed_price);
  if(/^\d+\.\d{3,}$/.test(decimal(row.proposed_price)))warnings.push({row:sourceRows?.[index]??index+2,field:'proposed_price',code:'ROUNDED_CURRENCY',value:sourcePrice,normalized:price});
  const input={...Object.fromEntries(DETAIL_FIELDS.map(f=>[f,normalizeCell(row[f])])),source_total_price:sourcePrice,source_availability:normalizeCell(row.status),company_id:company,project_id:project,version:0,code:typeof row.code==='boolean'?'':normalizeCell(row.code),building:normalizeCell(row.building),floor:normalizeCell(row.floor),category:normalizeCell(row.category),area:decimal(row.area),proposed_price:price,status,active};
  const result=importUnitSchema.safeParse(input);
  if(!result.success){for(const issue of result.error.issues){const field=String(issue.path[0]);errors.push({row:sourceRows?.[index]??index+2,field,code:'INVALID_VALUE',value:String(row[field]??'').slice(0,160)});}return;}
  const key=input.code.toLowerCase();if(seen.has(key))errors.push({row:sourceRows?.[index]??index+2,field:'code',code:'DUPLICATE_CODE',value:input.code});seen.add(key);units.push(result.data);
 });return {errors,warnings,units};
}
async function importAccess(sql:Sql,actor:Actor,company:string,project:string,platform:boolean){const ctx=await access(sql,actor,company,'inventory.write',platform,project);if(!ctx.owner&&!['company_admin','operations'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);}
const inputSchema=z.object({company_id:uuid,project_id:uuid,source_name:z.string().trim().min(1).max(200),rows:z.array(z.record(z.unknown())).min(1).max(1000),source_rows:z.array(z.number().int().min(2).max(1048576)).max(1000).optional()}).strict();
export async function importInventory(sql:Sql,actor:Actor,input:unknown,commit=false,platform=false){
 const c=inputSchema.parse(input);if(c.source_rows&&(c.source_rows.length!==c.rows.length||new Set(c.source_rows).size!==c.source_rows.length))throw new ServiceError('INVALID_SOURCE_ROWS');await importAccess(sql,actor,c.company_id,c.project_id,platform);
 const {units,errors,warnings}=validateImportRows(c.company_id,c.project_id,c.rows,c.source_rows);
 if(errors.length)return {ok:false,total:c.rows.length,errors,warnings,preview:units.slice(0,20)};
 const payload=units.map(u=>({code:u.code,building:u.building,floor:u.floor,category:u.category,area:u.area,price:minorUnits(u.proposed_price).toString(),status:u.status,active:u.active,details:detailValues(u)}));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)))),b=>b.toString(16).padStart(2,'0')).join('');
 const prior=await sql`SELECT id,unit_count FROM inventory_imports WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND payload_hash=${digest}`;
 if(prior.length)return {ok:true,already_imported:true,import_id:prior[0].id,total:prior[0].unit_count,errors:[],preview:[]};
 const existing=await sql`SELECT code FROM inventory_units WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND lower(code) IN(SELECT jsonb_array_elements_text(${JSON.stringify(payload.map(x=>x.code.toLowerCase()))}::jsonb))`;
 const codes=new Set(existing.map(x=>String(x.code).toLowerCase()));
 payload.forEach((u,i)=>{if(codes.has(u.code.toLowerCase()))errors.push({row:c.source_rows?.[i]??i+2,field:'code',code:'EXISTING_CODE'});});
 if(errors.length||!commit)return {ok:!errors.length,total:payload.length,errors,warnings,preview:units.slice(0,20)};
 const data=JSON.stringify(payload);
 const result=await sql.transaction([sql`SELECT id FROM projects WHERE company_id=${c.company_id} AND id=${c.project_id} FOR UPDATE`,sql`WITH batch AS(INSERT INTO inventory_imports(company_id,project_id,payload_hash,source_name,unit_count,actor_id) VALUES(${c.company_id},${c.project_id},${digest},${c.source_name},${payload.length},${actor.userId}) ON CONFLICT(company_id,project_id,payload_hash) DO NOTHING RETURNING *), created AS(INSERT INTO inventory_units(company_id,project_id,code,building,floor,category,area,proposed_price_minor,status,active,details) SELECT ${c.company_id},${c.project_id},r.code,r.building,r.floor,r.category,r.area::numeric,r.price::bigint,r.status,r.active,r.details FROM jsonb_to_recordset(${data}::jsonb) AS r(code text,building text,floor text,category text,area text,price text,status text,active boolean,details jsonb) CROSS JOIN batch RETURNING *), history AS(INSERT INTO unit_status_history(company_id,project_id,unit_id,next_status,actor_id) SELECT company_id,project_id,id,status,${actor.userId} FROM created), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${c.company_id},${actor.userId},${actor.email},'inventory.imported',jsonb_build_object('import_id',batch.id,'source_name',batch.source_name,'units',(SELECT jsonb_agg(to_jsonb(created)) FROM created)) FROM batch) SELECT id,unit_count,false AS already_imported FROM batch UNION ALL SELECT id,unit_count,true FROM inventory_imports WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND payload_hash=${digest}`]);
 const receipt=result[1][0];if(!receipt)throw new ServiceError('IMPORT_CONFLICT',409);return {ok:true,import_id:receipt.id,total:receipt.unit_count,already_imported:receipt.already_imported,errors:[],preview:[]};
}
