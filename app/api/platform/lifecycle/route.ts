import { platformIdentity, failure, json, sameOrigin } from '../../../../lib/bunyra/http';
import { deletionImpact, scheduleCompanyDeletion, restoreCompany, purgeCompany, retryCompanyStorage, type ObjectRemover } from '../../../../lib/bunyra/companies';
import { planStorage } from '../../../../lib/bunyra/storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { sql, actor } = await platformIdentity();
    return json(await deletionImpact(sql, actor, new URL(request.url).searchParams.get('company') || ''));
  } catch (e) { return failure(e); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sql, actor } = await platformIdentity();
    const body = await request.json();
    if (body?.operation === 'delete') return json(await scheduleCompanyDeletion(sql, actor, body));
    if (body?.operation === 'restore') return json(await restoreCompany(sql, actor, body));
    if (body?.operation === 'purge' || body?.operation === 'retry_storage') {
      let storage: ObjectRemover | undefined;
      try { storage = planStorage(); } catch { storage = undefined; }
      return json(await (body.operation === 'purge' ? purgeCompany : retryCompanyStorage)(sql, actor, body, storage));
    }
    return json({ error: 'VALIDATION_ERROR' }, 400);
  } catch (e) { return failure(e); }
}
