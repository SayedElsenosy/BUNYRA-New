import {z} from 'zod';
import {hasPermission} from './permissions';
import {access,ServiceError,type Sql,type Actor,uuid} from './service';

const settingsInput=z.object({
 company_id:uuid,
 team_id:uuid,
 enabled:z.boolean(),
 version:z.number().int().min(0),
});
async function authorize(sql:Sql,actor:Actor,company:string,asOwner:boolean){
 const ctx=await access(sql,actor,company,'members.manage',asOwner);
 if(!ctx.owner&&!hasPermission(ctx.role,ctx.custom,ctx.overrides,'leads.write'))throw new ServiceError('FORBIDDEN',403);
 return ctx;
}
export async function getLeadRouting(sql:Sql,actor:Actor,company:string,asOwner=false){
 uuid.parse(company);
 await authorize(sql,actor,company,asOwner);
 const [saved,teams]=await Promise.all([
  sql.query('SELECT team_id,enabled,next_index,version,updated_at FROM crm_lead_routing_settings WHERE company_id=$1::uuid',[company]),
  sql.query("SELECT t.id,t.name,t.active,COUNT(m.user_id) FILTER(WHERE m.active AND m.role IN('sales','sales_manager'))::int AS eligible FROM crm_sales_teams t LEFT JOIN crm_sales_team_members tm ON tm.company_id=t.company_id AND tm.team_id=t.id LEFT JOIN memberships m ON m.company_id=tm.company_id AND m.user_id=tm.user_id WHERE t.company_id=$1::uuid GROUP BY t.id ORDER BY t.name",[company])
 ]);
 return {settings:saved[0]||{team_id:null,enabled:false,next_index:0,version:0},teams};
}
export async function saveLeadRouting(sql:Sql,actor:Actor,input:unknown,asOwner=false){
 const c=settingsInput.parse(input);
 await authorize(sql,actor,c.company_id,asOwner);
 const teams=await sql.query(
  "SELECT t.id,COUNT(m.user_id) FILTER(WHERE m.active AND m.role IN('sales','sales_manager'))::int AS eligible FROM crm_sales_teams t LEFT JOIN crm_sales_team_members tm ON tm.company_id=t.company_id AND tm.team_id=t.id LEFT JOIN memberships m ON m.company_id=tm.company_id AND m.user_id=tm.user_id WHERE t.company_id=$1::uuid AND t.id=$2::uuid AND t.active GROUP BY t.id",
  [c.company_id,c.team_id]);
 if(!teams.length)throw new ServiceError('INVALID_ROUTING_TEAM',400);
 if(c.enabled&&Number(teams[0].eligible)<1)throw new ServiceError('ROUTING_NO_ELIGIBLE_MEMBERS',409);
 const result=await sql.query(
  "WITH changed AS (INSERT INTO crm_lead_routing_settings(company_id,team_id,enabled,updated_by) VALUES($1::uuid,$2::uuid,$3::boolean,$4::text) ON CONFLICT(company_id) DO UPDATE SET team_id=EXCLUDED.team_id,enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=now(),version=crm_lead_routing_settings.version+1 WHERE crm_lead_routing_settings.version=$5::integer RETURNING *) ,logged AS (INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) SELECT $1::uuid,$4::text,$6::text,'crm.lead_routing_configured',to_jsonb(changed) FROM changed) SELECT team_id,enabled,next_index,version,updated_at FROM changed",
  [c.company_id,c.team_id,c.enabled,actor.userId,c.version,actor.email]);
 if(!result.length)throw new ServiceError('VERSION_CONFLICT',409);
 return result[0];
}
