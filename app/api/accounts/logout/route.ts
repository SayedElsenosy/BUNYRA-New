import { cookies } from 'next/headers';
import { getDb } from '../../../../db';
import { tokenHash } from '../../../../lib/bunyra/service';
import { SESSION_COOKIE,clearSessionCookie } from '../../../../lib/auth/local-session';
import { sameOrigin,json,failure } from '../../../../lib/bunyra/http';
import { getAuth } from '../../../../lib/auth/server';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{sameOrigin(request);const token=(await cookies()).get(SESSION_COOKIE)?.value;if(token)await getDb()`DELETE FROM app_sessions WHERE token_hash=${await tokenHash(token)}`;await clearSessionCookie();try{await getAuth().signOut();}catch{}return json({ok:true});}catch(e){return failure(e);}}
