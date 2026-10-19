import { getCurrentUser } from '../auth/current-user';
import { getDb } from '../../db';
import { ServiceError,owner } from './service';
import { ZodError } from 'zod';
import { tenantSql } from './tenant';
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
export function sameOrigin(request:Request){if(request.headers.get('origin')!==new URL(request.url).origin)throw new ServiceError('INVALID_ORIGIN',403);}
export async function identity(){const user=await getCurrentUser();if(!user)throw new ServiceError('UNAUTHORIZED',401);return {sql:tenantSql(getDb()),actor:{userId:user.userId,email:user.email},user};}
export async function bootstrapOwner(sql:ReturnType<typeof getDb>,actor:{userId:string;email:string}){
 const expected=process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase();
 if(process.env.ALLOW_OWNER_BOOTSTRAP!=='true'||!expected||actor.email.toLowerCase()!==expected)return;
 await sql`WITH created AS(INSERT INTO platform_owner(singleton,user_id,email) VALUES(true,${actor.userId},${actor.email}) ON CONFLICT DO NOTHING RETURNING user_id,email), logged AS(INSERT INTO audit_logs(actor_id,actor_email,action) SELECT user_id,email,'platform_owner.initialized' FROM created) SELECT user_id FROM created`;
}
export async function platformIdentity(){const ctx=await identity();await bootstrapOwner(ctx.sql,ctx.actor);if(!await owner(ctx.sql,ctx.actor))throw new ServiceError('FORBIDDEN',403);return ctx;}
export function failure(error:unknown){if(error instanceof ServiceError)return json({error:error.code},error.status);if(error instanceof ZodError||error instanceof SyntaxError)return json({error:'VALIDATION_ERROR'},400);const code=(error as {code?:string})?.code;if(code==='23505')return json({error:'ALREADY_EXISTS'},409);if(code==='23503')return json({error:'INVALID_REFERENCE'},400);if(code==='P0001'&&['PRICING_FORBIDDEN','PRICING_CONFLICT','PRICING_SOURCE_CHANGED','APPROVED_PRICE_BOOK_IMMUTABLE','PRICING_SCOPE_IMMUTABLE','INVALID_EFFECTIVE_PRICE'].includes((error as Error).message))return json({error:(error as Error).message},(error as Error).message==='PRICING_FORBIDDEN'?403:409);if(code==='P0001'&&['ACCOUNT_LIMIT_REACHED','LIMIT_BELOW_USAGE','COMPANY_INACTIVE'].includes((error as Error).message))return json({error:(error as Error).message},409);return json({error:'SERVICE_UNAVAILABLE'},503);}
