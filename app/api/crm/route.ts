import {requireEntitled} from '../../../lib/bunyra/subscriptions';
import { identity, sameOrigin, json, failure } from '../../../lib/bunyra/http';
import { addFollowUp, addInteraction, createCustomer, crmOverview, updateLead, recordLeadAction } from '../../../lib/bunyra/crm';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { sql, actor } = await identity();
    const url = new URL(request.url);
    const company = url.searchParams.get('company') || '';
    await requireEntitled(sql,actor,company,'crm',url.searchParams.get('mode')==='platform');
    return json(await crmOverview(sql, actor, company, {
      customer:url.searchParams.get('customer')||undefined,
      q: url.searchParams.get('q') || '',
      status: url.searchParams.get('status') || '',
      owner: url.searchParams.get('owner') || '',
      asOwner: url.searchParams.get('mode') === 'platform',
    }));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sql, actor } = await identity();
    const input = await request.json() as { operation?: string; company_id?: string; [key: string]: unknown };
    const asOwner = new URL(request.url).searchParams.get('mode') === 'platform';
    await requireEntitled(sql,actor,String(input.company_id||''),'crm',asOwner);
    if (input.operation === 'lead_action') { const {operation,...action}=input; return json(await recordLeadAction(sql,actor,action,asOwner)); }
    if (input.operation === 'customer') return json(await createCustomer(sql, actor, input, asOwner, true), 201);
    if (input.operation === 'lead') return json({ error: 'USE_CUSTOMER_RECORD' }, 410);
    if (input.operation === 'interaction') return json(await addInteraction(sql, actor, input, asOwner), 201);
    if (input.operation === 'follow_up') return json(await addFollowUp(sql, actor, input, asOwner), 201);
    return json({ error: 'VALIDATION_ERROR' }, 400);
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const { sql, actor } = await identity();
    const body=await request.json(),platform=new URL(request.url).searchParams.get('mode')==='platform';await requireEntitled(sql,actor,String(body.company_id||''),'crm',platform);return json(await updateLead(sql, actor, body, platform));
  } catch (error) {
    return failure(error);
  }
}
