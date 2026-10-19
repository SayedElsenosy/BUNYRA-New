import 'server-only';
import { cookies } from 'next/headers';
export const SESSION_COOKIE='bunyra_session';
export async function sessionCookie(token:string){(await cookies()).set(SESSION_COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:12*60*60});}
export async function clearSessionCookie(){(await cookies()).set(SESSION_COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:0});}
