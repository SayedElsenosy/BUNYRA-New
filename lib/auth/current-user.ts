import 'server-only';
import { getAuth } from './server';
export async function getCurrentUser(){
 const {data,error}=await getAuth().getSession();
 if(error)throw new Error('AUTH_SERVICE_UNAVAILABLE');
 const user=data?.user;
 // Email verification is required before trusting email-bound owner setup or invitations.
 if(!user||user.emailVerified!==true)return null;
 return {userId:user.id,email:user.email,displayName:user.name||user.email,fullName:user.name||null};
}
