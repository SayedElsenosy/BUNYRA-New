import { identity, sameOrigin, failure } from '../../../lib/bunyra/http';
import { createOffer } from '../../../lib/bunyra/commercial';
import { renderOfferPdf } from '../../../lib/bunyra/offer-pdf';
export const dynamic='force-dynamic';
export async function POST(request: Request) { try { sameOrigin(request); const {sql,actor}=await identity(); const platform=new URL(request.url).searchParams.get('mode')==='platform'; const offer=await createOffer(sql,actor,await request.json(),platform); const bytes=renderOfferPdf(offer as unknown as Parameters<typeof renderOfferPdf>[0]); return new Response(bytes,{status:200,headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="bunyra-offer.pdf"; filename*=UTF-8''${encodeURIComponent('bunyra-offer-'+offer.unit.code+'.pdf')}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}); } catch(e){return failure(e);} }
