import { getCurrentUser } from '../../../../lib/auth/current-user';
import { getDb } from '../../../../db';
import { ownAccount,saveOwnAccount,createSession } from '../../../../lib/bunyra/accounts';
import { owner,ServiceError } from '../../../../lib/bunyra/service';
import { sameOrigin,json,failure } from '../../../../lib/bunyra/http';
import { sessionCookie } from '../../../../lib/auth/local-session';
export const dynamic='force-dynamic';
async function context(){const user=await getCurrentUser();if(!user)throw new ServiceError('UNAUTHORIZED',401);const sql=getDb();return {sql,user,isOwner:await owner(sql,user)};}
export async function GET(){try{const {sql,user,isOwner}=await context();return json({user,account:await ownAccount(sql,user),is_owner:isOwner});}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);const {sql,user,isOwner}=await context();const saved=await saveOwnAccount(sql,user,await request.json());await sessionCookie(await createSession(sql,user.userId,saved.passwordVersion));return json({redirect:isOwner?'/owner':'/company'});}catch(e){return failure(e);}}
