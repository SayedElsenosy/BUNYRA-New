import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {validateImportRows,normalizeCell,type ImportRow} from './imports';
import {minorUnits} from './projects';
import {DETAIL_FIELDS,detailValues} from './unit-fields';
const snapshot=z.object({code:z.string(),id:uuid.nullable(),version:z.number().int().positive().nullable()}).strict();
const schema=z.object({company_id:uuid,project_id:uuid,source_name:z.string().trim().min(1).max(200),rows:z.array(z.record(z.unknown())).min(1).max(1000),source_rows:z.array(z.number().int().min(2).max(1048576)).max(1000).optional(),expected:z.array(snapshot).max(1000).optional()}).strict();
type Existing={id:string;code:string;version:number;building:string;floor:string;category:string;area:string;price:string;status:string;active:boolean;details:Record<string,string>};
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
const amount=(v:string)=>{const n=BigInt(v).toString().padStart(3,'0');return n.slice(0,-2)+'.'+n.slice(-2);};
export async function syncInventory(sql:Sql,actor:Actor,input:unknown,commit=false,platform=false){
 const c=schema.parse(input);
 if(c.source_rows&&(c.source_rows.length!==c.rows.length||new Set(c.source_rows).size!==c.rows.length))throw new ServiceError('INVALID_SOURCE_ROWS');
 const ctx=await access(sql,actor,c.company_id,'inventory.write',platform,c.project_id);
 if(!ctx.owner&&!['company_admin','operations'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
 const existing=await sql`SELECT id,code,version,building,floor,category,area::text,proposed_price_minor::text AS price,status,active,details FROM inventory_units WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND lower(code) IN(SELECT jsonb_array_elements_text(${JSON.stringify(c.rows.map(r=>normalizeCell(r.code).toLowerCase()))}::jsonb))` as Existing[];
 const byCode=new Map(existing.map(u=>[u.code.toLowerCase(),u]));
 // Missing optional columns preserve current values. Blank mapped cells are deliberate edits.
 const merged=c.rows.map(row=>{const old=byCode.get(normalizeCell(row.code).toLowerCase());return old?{...old.details,building:old.building,floor:old.floor,category:old.category,area:String(Number(old.area)),proposed_price:amount(old.price),status:old.status,active:old.active,...row}:row;});
 const {units,errors,warnings}=validateImportRows(c.company_id,c.project_id,merged,c.source_rows);
 if(errors.length)return {ok:false,total:c.rows.length,errors,warnings,preview:[]};
 const summary={created:0,updated:0,unchanged:0};
 const expected=c.rows.map(r=>{const old=byCode.get(normalizeCell(r.code).toLowerCase());return {code:normalizeCell(r.code).toLowerCase(),id:old?.id??null,version:old?.version??null};});
 const items=units.map((u,i)=>{
  const old=byCode.get(u.code.toLowerCase()),row=c.rows[i];
  const details=old?{...old.details,...Object.fromEntries(DETAIL_FIELDS.filter(f=>own(row,f)).map(f=>[f,u[f]])),...(own(row,'proposed_price')?{source_total_price:u.source_total_price}:{}),...(own(row,'status')?{source_availability:u.source_availability}:{})}:detailValues(u);
  const next={building:u.building,floor:u.floor,category:u.category,area:String(Number(u.area)),price:minorUnits(u.proposed_price).toString(),status:u.status,active:u.active,details};
  const fields=old?Object.keys(next).filter(k=>k==='area'?Number(old.area)!==Number(next.area):k==='details'?JSON.stringify(Object.entries(old.details).sort())!==JSON.stringify(Object.entries(details).sort()):old[k as keyof Existing]!==next[k as keyof typeof next]):Object.keys(next);
  const kind=!old?'create':fields.length?'update':'unchanged';summary[kind==='create'?'created':kind==='update'?'updated':'unchanged']++;
  if(kind==='update'&&(!['available','unavailable'].includes(old!.status)||!['available','unavailable'].includes(u.status)))errors.push({row:c.source_rows?.[i]??i+2,field:'status',code:'UNIT_COMMITTED',value:old!.status});
  return {code:old?.code??u.code,id:old?.id??null,expected_version:old?.version??null,kind,...next,changes:fields.flatMap(f=>f==='details'?Object.keys(details).filter(k=>old?.details[k]!==details[k]).map(k=>'details.'+k):[f]),before:old??null};
 });
 const preview=units.slice(0,20),changes=items.filter(u=>u.kind!=='unchanged').slice(0,100).map(u=>({code:u.code,kind:u.kind,fields:u.changes,before:u.before,after:{...u,changes:undefined,before:undefined}}));
 if(errors.length||!commit)return {ok:!errors.length,total:units.length,errors,warnings,preview,summary,changes,expected};
 if(!c.expected||c.expected.length!==items.length||new Set(c.expected.map(e=>e.code)).size!==items.length)throw new ServiceError('IMPORT_CONFLICT',409);
 const expectedByCode=new Map(c.expected.map(e=>[e.code,e]));
 // The receipt includes the preview's versions: retrying one commit is idempotent,
 // while a later edit or reverting a value remains a new, auditable operation.
 const payload=items.map(({changes,before,...u})=>{const e=expectedByCode.get(u.code.toLowerCase());return {...u,details:Object.fromEntries(Object.entries(u.details).sort(([a],[b])=>a.localeCompare(b))),id:e?.id??null,expected_version:e?.version??null};});
 const fingerprint=JSON.stringify({mode:'sync',items:payload.map(({kind,...u})=>u)});
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint))),b=>b.toString(16).padStart(2,'0')).join('');
 // Check a completed retry before treating its now-stale versions as a conflict.
 const prior=await sql`SELECT id FROM inventory_imports WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND payload_hash=${digest}`;
 if(prior.length)return {ok:true,total:units.length,import_id:prior[0].id,already_imported:true,errors:[],preview:[],summary};
 if(expected.some(e=>{const p=expectedByCode.get(e.code);return !p||p.id!==e.id||p.version!==e.version;}))throw new ServiceError('IMPORT_CONFLICT',409);
 try{
  const result=await sql`SELECT bunyra_sync_inventory(${c.company_id}::uuid,${c.project_id}::uuid,${actor.userId},${actor.email},${digest},${c.source_name},${JSON.stringify(payload)}::jsonb) AS receipt`;
  return {ok:true,total:units.length,...result[0].receipt,errors:[],preview:[],summary};
 }catch(e){if((e as {message?:string}).message?.includes('IMPORT_CONFLICT')||(e as {code?:string}).code==='23505')throw new ServiceError('IMPORT_CONFLICT',409);throw e;}
}
