import {z} from 'zod';
import {access,ServiceError,uuid,type Sql,type Actor} from './service';
import {hasPermission} from './permissions';
const label=z.string().trim().min(1).max(160);
const code=z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/);
const optional=z.string().trim().max(500).default('');
const money=z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const configurationSchema=z.object({
 name:label,name_en:optional,code,location:optional,type:z.enum(['residential','commercial','administrative','mixed']),
 currency:z.string().regex(/^[A-Z]{3}$/).default('EGP'),
 phases:z.array(z.object({code,name:label})).max(100),
 buildings:z.array(z.object({code,name:label,phase:code})).max(500),
 floors:z.array(z.object({code,name:label,building:code,plan_url:z.union([z.literal(''),z.string().url().max(2048).refine(v=>new URL(v).protocol==='https:')]).default('')})).max(2000),
 categories:z.array(z.object({code,name:label})).max(100),
 units:z.array(z.object({code,floor:code,category:code,area:z.string().regex(/^\d{1,7}(\.\d{1,2})?$/).refine(v=>Number(v)>0),price:money,active:z.boolean().default(true)})).max(5000),
 plans:z.array(z.object({code,name:label,down_payment_bps:z.number().int().min(0).max(10000),installments:z.number().int().min(1).max(600),interval_months:z.number().int().min(1).max(120)})).max(100),
 financial_notes:optional
}).strict().superRefine((c,ctx)=>{
 const groups=['phases','buildings','floors','categories','units','plans'] as const;
 for(const group of groups){const seen=new Set<string>();c[group].forEach((v,i)=>{const k=v.code.toLowerCase();if(seen.has(k))ctx.addIssue({code:'custom',path:[group,i,'code'],message:'DUPLICATE_CODE'});seen.add(k);});}
 const has=(group:'phases'|'buildings'|'floors'|'categories',v:string)=>c[group].some(x=>x.code===v);
 for(const b of c.buildings)if(!has('phases',b.phase))ctx.addIssue({code:'custom',path:['buildings'],message:'INVALID_PHASE'});
 for(const f of c.floors)if(!has('buildings',f.building))ctx.addIssue({code:'custom',path:['floors'],message:'INVALID_BUILDING'});
 for(const u of c.units)if(!has('floors',u.floor)||!has('categories',u.category))ctx.addIssue({code:'custom',path:['units'],message:'INVALID_UNIT_REFERENCE'});
});
export type Configuration=z.infer<typeof configurationSchema>;
export function readiness(c:Configuration){return {metadata:!!c.location,structure:!!c.phases.length&&!!c.buildings.length&&!!c.floors.length,categories:!!c.categories.length,units:!!c.units.length,plans:!!c.plans.length,prices:!!c.units.length&&c.units.every(u=>minorUnits(u.price)>BigInt(0)),floor_plans:!!c.floors.length&&c.floors.every(f=>!!f.plan_url),published:false};}
export function minorUnits(value:string){if(!/^\d{1,12}(\.\d{1,2})?$/.test(value))throw new ServiceError('INVALID_AMOUNT');const [whole,fraction='']=value.split('.');return BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));}
export function calculatePlan(price:string,bps:number,count:number){if(!Number.isInteger(bps)||bps<0||bps>10000||!Number.isInteger(count)||count<1||count>600)throw new ServiceError('INVALID_PLAN');const total=minorUnits(price),down=(total*BigInt(bps)+BigInt(5000))/BigInt(10000),remaining=total-down,base=remaining/BigInt(count),extra=remaining%BigInt(count);return {total:total.toString(),down_payment:down.toString(),installments:Array.from({length:count},(_,i)=>(base+(BigInt(i)<extra?BigInt(1):BigInt(0))).toString())};}
export async function projectList(sql:Sql,actor:Actor,company:string,platform=false){const ctx=await access(sql,actor,company,'company.read',platform);const rows=await sql`SELECT p.id,p.name,coalesce(s.version,0) AS version,s.configuration,s.updated_at FROM projects p LEFT JOIN project_setups s ON s.project_id=p.id AND s.company_id=p.company_id WHERE p.company_id=${company} ORDER BY p.name`;return {projects:rows.filter(p=>ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'projects.read',p.id)).map(p=>({...p,configuration:(ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'projects.write',p.id))?p.configuration:null,can_write:ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'projects.write',p.id)})),can_create:ctx.owner||hasPermission(ctx.role,ctx.custom,ctx.overrides,'projects.write')};}
export async function saveProject(sql:Sql,actor:Actor,input:unknown,platform=false){
 const v=z.object({company_id:uuid,id:uuid.optional(),version:z.number().int().min(0),configuration:configurationSchema}).strict().parse(input);
 await access(sql,actor,v.company_id,'projects.write',platform,v.id);
 const config=JSON.stringify(v.configuration);
 const mutation=v.id?sql`WITH previous AS(SELECT p.id,p.name,s.configuration,coalesce(s.version,0) AS version FROM projects p LEFT JOIN project_setups s ON s.company_id=p.company_id AND s.project_id=p.id WHERE p.company_id=${v.company_id} AND p.id=${v.id} AND coalesce(s.version,0)=${v.version}), renamed AS(UPDATE projects SET name=${v.configuration.name} WHERE company_id=${v.company_id} AND id IN(SELECT id FROM previous) RETURNING id), changed AS(INSERT INTO project_setups(company_id,project_id,configuration) SELECT ${v.company_id},id,${config}::jsonb FROM renamed ON CONFLICT(project_id) DO UPDATE SET configuration=excluded.configuration,version=project_setups.version+1,updated_at=now() RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) SELECT ${v.company_id},${actor.userId},${actor.email},'project.draft_updated',to_jsonb(previous),to_jsonb(changed) FROM changed JOIN previous ON previous.id=changed.project_id) SELECT project_id AS id,version FROM changed`:sql`WITH created AS(INSERT INTO projects(company_id,name) VALUES(${v.company_id},${v.configuration.name}) RETURNING id), changed AS(INSERT INTO project_setups(company_id,project_id,configuration) SELECT ${v.company_id},id,${config}::jsonb FROM created RETURNING *), logged AS(INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT ${v.company_id},${actor.userId},${actor.email},'project.draft_created',to_jsonb(changed) FROM changed) SELECT project_id AS id,version FROM changed`;
 if(!v.id&&v.version!==0)throw new ServiceError('VERSION_CONFLICT',409);
 const result=await sql.transaction([sql`SELECT id FROM companies WHERE id=${v.company_id} FOR UPDATE`,mutation]);if(!result[1].length)throw new ServiceError('VERSION_CONFLICT',409);return {...result[1][0],readiness:readiness(v.configuration)};
}
