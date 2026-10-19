import type { NextRequest } from 'next/server';
import { getAuth } from '../../../../lib/auth/server';
export const dynamic='force-dynamic';
type Context={params:Promise<{path:string[]}>};
export async function GET(request:NextRequest,context:Context){return getAuth().handler().GET(request,context);}
// Managed accounts are provisioned only through the authorized BUNYRA console.
export async function POST(){return Response.json({error:'MANAGED_ACCOUNTS_ONLY'},{status:403});}
