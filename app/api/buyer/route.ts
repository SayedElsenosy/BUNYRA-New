import { identity, sameOrigin, json, failure } from '../../../lib/bunyra/http';
import { buyerOverview, buyerRequestMatches, createBuyerRequest } from '../../../lib/bunyra/buyer';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { sql, actor } = await identity();
    const url = new URL(request.url);
    const company = url.searchParams.get('company') || '';
    const mode = url.searchParams.get('mode') === 'platform';
    const requestId = url.searchParams.get('request');
    return json(requestId ? await buyerRequestMatches(sql, actor, company, requestId, mode) : await buyerOverview(sql, actor, company, mode));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sql, actor } = await identity();
    return json(await createBuyerRequest(sql, actor, await request.json(), new URL(request.url).searchParams.get('mode') === 'platform'));
  } catch (error) { return failure(error); }
}
