import { identity, sameOrigin, json, failure } from '../../../lib/bunyra/http';
import { addFollowUp, addInteraction, createCustomer, createLead, crmOverview, updateLead } from '../../../lib/bunyra/crm';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { sql, actor } = await identity();
    const url = new URL(request.url);
    const company = url.searchParams.get('company') || '';
    return json(await crmOverview(sql, actor, company, {
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
    if (input.operation === 'customer') return json(await createCustomer(sql, actor, input, asOwner), 201);
    if (input.operation === 'lead') return json(await createLead(sql, actor, input, asOwner), 201);
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
    return json(await updateLead(sql, actor, await request.json(), new URL(request.url).searchParams.get('mode') === 'platform'));
  } catch (error) {
    return failure(error);
  }
}
