import { identity, sameOrigin, json, failure } from '../../../lib/bunyra/http';
import { buyerOverview, buyerRequestMatches, createBuyerRequest } from '../../../lib/bunyra/buyer';
import {requireEntitled} from '../../../lib/bunyra/subscriptions';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { sql, actor } = await identity();
    const url = new URL(request.url);
    const company = url.searchParams.get('company') || '';
    const mode = url.searchParams.get('mode') === 'platform';
    await requireEntitled(sql,actor,company,'buyer_matching',mode);
    const requestId = url.searchParams.get('request');
    return json(requestId ? await buyerRequestMatches(sql, actor, company, requestId, mode) : await buyerOverview(sql, actor, company, mode, {customer:url.searchParams.get('customer')||undefined,request:url.searchParams.get('target')||undefined}));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sql, actor } = await identity();
    const body=await request.json();
    const platform=new URL(request.url).searchParams.get('mode')==='platform';
    await requireEntitled(sql,actor,String(body.company_id||''),'buyer_matching',platform);
    return json(await createBuyerRequest(sql, actor, body, platform));
  } catch (error) { return failure(error); }
}
