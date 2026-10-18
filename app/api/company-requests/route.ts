import { getDb } from '../../../db';
import { platformIdentity, failure, json, sameOrigin } from '../../../lib/bunyra/http';
import { submitCompanyRequest, listCompanyRequests, reviewCompanyRequest } from '../../../lib/bunyra/companies';

export const dynamic = 'force-dynamic';

// Public: anyone can ask for a company account; nothing is created until the platform owner approves.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    return json(await submitCompanyRequest(getDb(), await request.json()), 201);
  } catch (e) { return failure(e); }
}

export async function GET() {
  try {
    const { sql, actor } = await platformIdentity();
    return json({ requests: await listCompanyRequests(sql, actor) });
  } catch (e) { return failure(e); }
}

export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const { sql, actor } = await platformIdentity();
    return json(await reviewCompanyRequest(sql, actor, await request.json()));
  } catch (e) { return failure(e); }
}
