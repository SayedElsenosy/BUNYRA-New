import { z } from 'zod';
import { getDb } from '../../../../db';
import { authenticateAccount,throttleLogin,createSession,saveOwnAccount } from '../../../../lib/bunyra/accounts';
import { usernameSchema } from '../../../../lib/bunyra/passwords';
import { sameOrigin,json,failure } from '../../../../lib/bunyra/http';
import { ServiceError } from '../../../../lib/bunyra/service';
import { sessionCookie } from '../../../../lib/auth/local-session';
import { getAuth } from '../../../../lib/auth/server';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 sameOrigin(request);const c=z.object({username:usernameSchema,password:z.string().min(1).max(128),portal:z.enum(['owner','company'])}).parse(await request.json());const sql=getDb();
 await throttleLogin(sql,c.username,request.headers.get('cf-connecting-ip')||'local');
 // One-time owner migration verifies the existing password with the current IdP.
 // It preserves the platform_owner user ID; no owner is ever created by email alone.
 if(c.portal==='owner'){const o=(await sql`SELECT o.user_id,o.email FROM platform_owner o WHERE lower(o.email)=${c.username} AND NOT EXISTS(SELECT 1 FROM app_accounts a WHERE a.user_id=o.user_id)`)[0];if(o){
  const r=await getAuth().signIn.email({email:o.email,password:c.password});const u=r.data?.user;
  if(r.error||!u||u.id!==o.user_id||u.emailVerified!==true)throw new ServiceError('INVALID_CREDENTIALS',401);
  if(c.password.length<12)return json({redirect:'/account'});
  await saveOwnAccount(sql,{userId:u.id,email:u.email},{username:c.username,display_name:u.name||u.email,email:u.email,password:c.password});
 }}
 const user=await authenticateAccount(sql,c.username,c.password,c.portal);await sessionCookie(await createSession(sql,user.userId,user.passwordVersion));
 return json({redirect:user.mustChangePassword?'/account':c.portal==='owner'?'/owner':'/company'});
}catch(e){return failure(e);}}
