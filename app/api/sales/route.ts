import { identity, sameOrigin, json, failure } from '../../../lib/bunyra/http';
import { addTeamMember, moveLeadStage, reorderStages, salesOverview, saveSalesTeam, saveStage, transferLead, updateFollowUp } from '../../../lib/bunyra/sales';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { sql, actor } = await identity();
    const url = new URL(request.url);
    return json(await salesOverview(sql, actor, url.searchParams.get('company') || '', url.searchParams.get('mode') === 'platform'));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { sql, actor } = await identity();
    const input = await request.json() as { operation?: string; [key: string]: unknown };
    const owner = new URL(request.url).searchParams.get('mode') === 'platform';
    if (input.operation === 'stage') return json(await saveStage(sql, actor, input, owner), 201);
    if (input.operation === 'reorder_stages') return json(await reorderStages(sql, actor, input, owner));
    if (input.operation === 'team') return json(await saveSalesTeam(sql, actor, input, owner), 201);
    if (input.operation === 'team_member') return json(await addTeamMember(sql, actor, input, owner));
    if (input.operation === 'transfer') return json(await transferLead(sql, actor, input, owner));
    if (input.operation === 'move_stage') return json(await moveLeadStage(sql, actor, input, owner));
    if (input.operation === 'follow_up_status') return json(await updateFollowUp(sql, actor, input, owner));
    return json({ error: 'VALIDATION_ERROR' }, 400);
  } catch (error) { return failure(error); }
}
