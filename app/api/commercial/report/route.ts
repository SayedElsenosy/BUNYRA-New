import { identity, failure, json } from '../../../../lib/bunyra/http';
import { bookingDocumentsReport } from '../../../../lib/bunyra/commercial';
export const dynamic='force-dynamic';
export async function GET(request: Request) { try { const {sql,actor}=await identity(); const u=new URL(request.url),company=u.searchParams.get('company')||''; return json(await bookingDocumentsReport(sql,actor,company,u.searchParams.get('mode')==='platform')); } catch(e){return failure(e);} }
