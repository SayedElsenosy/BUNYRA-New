import { scrypt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
export const passwordSchema=z.string().min(12).max(128);
export const usernameSchema=z.string().trim().toLowerCase().regex(/^[a-z0-9_.@-]{3,100}$/);
const options={N:16384,r:8,p:5,maxmem:32*1024*1024};
const derive=(password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,32,options,(error,key)=>error?reject(error):resolve(key)));
export async function hashPassword(password:string){passwordSchema.parse(password);const salt=Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');return 'scrypt-v1$'+salt+'$'+(await derive(password,salt)).toString('hex');}
export async function verifyPassword(password:string,hash:string){
 if(password.length<1||password.length>128)return false;
 const parts=hash.split('$');if(parts.length!==3||parts[0]!=='scrypt-v1'||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{64}$/.test(parts[2]))return false;
 return timingSafeEqual(await derive(password,parts[1]),Buffer.from(parts[2],'hex'));
}
export const DUMMY_HASH='scrypt-v1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';
