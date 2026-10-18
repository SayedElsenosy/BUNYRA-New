import { getDb } from '../../../db';
export const dynamic='force-dynamic';
export async function GET(){
 const ready=!!process.env.DATABASE_URL&&!!process.env.NEON_AUTH_BASE_URL&&(process.env.NEON_AUTH_COOKIE_SECRET?.length||0)>=32;
 const headers={'Cache-Control':'no-store'};
 if(!ready)return Response.json({status:'configuration_required',service:'bunyra'},{status:503,headers});
 try{
  await getDb()`SELECT 1 AS connected`;
  return Response.json({status:'ok',service:'bunyra',database:'connected'},{headers});
 }catch{
  return Response.json({status:'unavailable',service:'bunyra',database:'unavailable'},{status:503,headers});
 }
}
