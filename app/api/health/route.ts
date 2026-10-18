export const dynamic='force-dynamic';
export function GET(){
 const ready=!!process.env.DATABASE_URL&&!!process.env.NEON_AUTH_BASE_URL&&(process.env.NEON_AUTH_COOKIE_SECRET?.length||0)>=32;
 return Response.json({status:ready?'ok':'configuration_required',service:'bunyra'},{status:ready?200:503,headers:{'Cache-Control':'no-store'}});
}
