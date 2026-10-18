import { identity,bootstrapOwner,json,failure } from '../../../lib/bunyra/http';
import { owner } from '../../../lib/bunyra/service';
export const dynamic='force-dynamic';
export async function GET(){try{const {sql,actor,user}=await identity();await bootstrapOwner(sql,actor);const is_owner=await owner(sql,actor);const companies=await sql`SELECT c.id,c.name,c.name_en,m.role,r.name AS custom_role_name FROM memberships m JOIN companies c ON c.id=m.company_id LEFT JOIN custom_roles r ON r.company_id=m.company_id AND r.id=m.custom_role_id WHERE m.user_id=${actor.userId} AND m.active AND c.status='active' ORDER BY c.name`;return json({user:{name:user.displayName,email:user.email},is_owner,companies});}catch(e){return failure(e);}}
