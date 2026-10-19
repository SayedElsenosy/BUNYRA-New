import 'server-only';
import { getAuth } from './server';
import { cookies } from 'next/headers';
import { getDb } from '../../db';
import { readSession } from '../bunyra/accounts';
import { SESSION_COOKIE } from './local-session';
export async function getCurrentUser(){
 const token=(await cookies()).get(SESSION_COOKIE)?.value;
 if(token)return readSession(getDb(),token);
 if((await getDb()`SELECT a.user_id FROM app_accounts a JOIN platform_owner o ON o.user_id=a.user_id`).length)return null;
 const {data,error}=await getAuth().getSession();
 if(error)throw new Error('AUTH_SERVICE_UNAVAILABLE');
 const user=data?.user;
 // Email verification is required before trusting email-bound owner setup or invitations.
 if(!user||user.emailVerified!==true)return null;
 if(!(await getDb()`SELECT user_id FROM platform_owner WHERE user_id=${user.id}`).length)return null;
 // Existing verified sessions only bridge the owner to internal credentials.
 // Once provisioned, a local account can never fall back to a provider session.
 if((await getDb()`SELECT user_id FROM app_accounts WHERE user_id=${user.id}`).length)return null;
 return {userId:user.id,email:user.email,displayName:user.name||user.email,fullName:user.name||null,mustChangePassword:false};
}
