import 'server-only';
import { createNeonAuth } from '@neondatabase/auth/next/server';
let instance:ReturnType<typeof createNeonAuth>|undefined;
export function getAuth(){
 if(instance)return instance;
 const baseUrl=process.env.NEON_AUTH_BASE_URL;
 const secret=process.env.NEON_AUTH_COOKIE_SECRET;
 if(!baseUrl||!secret||secret.length<32)throw new Error('AUTH_NOT_CONFIGURED');
 instance=createNeonAuth({baseUrl,cookies:{secret},logLevel:'silent'});
 return instance;
}
