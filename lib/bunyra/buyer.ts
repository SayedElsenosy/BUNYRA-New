import { z } from 'zod';
import { access, ServiceError, uuid, type Actor, type Sql } from './service';

const requestInput = z.object({
  company_id: uuid,
  id: uuid.optional(),
  customer_id: uuid,
  project_id: uuid.nullable().optional(),
  unit_category: z.string().trim().max(120).default(''),
  min_area: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).nullable().optional(),
  max_area: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).nullable().optional(),
  max_budget: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).nullable().optional(),
  payment_plan_code: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(2000).default(''),
}).strict().superRefine((v, ctx) => {
  if (v.min_area && v.max_area && Number(v.min_area) > Number(v.max_area)) ctx.addIssue({ code: 'custom', message: 'INVALID_AREA_RANGE' });
});

async function matchRows(sql: Sql, company: string, request: { project_id?: string | null; unit_category?: string; min_area?: string | null; max_area?: string | null; max_budget?: string | null; payment_plan_code?: string }) {
  return sql`
    SELECT u.id,u.code,u.building,u.floor,u.category,u.area::text,e.price_minor::text,b.currency,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id',p.id,'code',p.code,'name',p.name,'down_payment_bps',p.down_payment_bps,
        'installments',p.installments,'interval_months',p.interval_months,
        'effective_price_minor',(((e.price_minor::numeric*(10000+p.adjustment_bps)+5000)/10000)::bigint)::text
      )) FILTER(WHERE p.id IS NOT NULL),'[]'::jsonb) AS plans
    FROM inventory_units u
    JOIN project_pricing active ON active.company_id=u.company_id AND active.project_id=u.project_id
    JOIN price_books b ON b.company_id=active.company_id AND b.project_id=active.project_id AND b.id=active.book_id AND b.status='approved'
    JOIN price_book_entries e ON e.company_id=u.company_id AND e.project_id=u.project_id AND e.book_id=b.id AND e.unit_id=u.id AND e.source_unit_version=u.version
    LEFT JOIN price_book_entry_plans ep ON ep.company_id=e.company_id AND ep.project_id=e.project_id AND ep.book_id=e.book_id AND ep.unit_id=e.unit_id
    LEFT JOIN price_book_plans p ON p.company_id=ep.company_id AND p.project_id=ep.project_id AND p.book_id=ep.book_id AND p.id=ep.plan_id
    WHERE u.company_id=${company}
      AND u.active AND u.status='available'
      AND (${request.project_id || null}::uuid IS NULL OR u.project_id=${request.project_id || null}::uuid)
      AND (${request.unit_category || ''}='' OR lower(u.category)=lower(${request.unit_category || ''}))
      AND (${request.min_area || null}::numeric IS NULL OR u.area>=${request.min_area || null}::numeric)
      AND (${request.max_area || null}::numeric IS NULL OR u.area<=${request.max_area || null}::numeric)
      AND (${request.max_budget || null}::bigint IS NULL OR e.price_minor<=(${request.max_budget || null}::numeric*100)::bigint)
      AND (${request.payment_plan_code || ''}='' OR p.code=${request.payment_plan_code || ''})
    GROUP BY u.id,e.price_minor,b.currency
    ORDER BY u.code
    LIMIT 200`;
}

export async function buyerOverview(sql: Sql, actor: Actor, companyId: string, asOwner = false) {
  const ctx = await access(sql, actor, companyId, 'leads.read', asOwner);
  const [customers, projects, requests] = await Promise.all([
    sql`SELECT id,full_name,phone,email FROM crm_customers WHERE company_id=${companyId} ORDER BY full_name LIMIT 500`,
    sql`SELECT id,name FROM projects WHERE company_id=${companyId} ORDER BY name`,
    sql`SELECT r.id,r.customer_id,c.full_name,r.project_id,p.name AS project_name,r.unit_category,r.min_area::text,r.max_area::text,r.max_budget_minor::text,r.payment_plan_code,r.status,r.notes,r.created_at,r.updated_at FROM buyer_requests r JOIN crm_customers c ON c.company_id=r.company_id AND c.id=r.customer_id LEFT JOIN projects p ON p.company_id=r.company_id AND p.id=r.project_id WHERE r.company_id=${companyId} ORDER BY r.updated_at DESC LIMIT 100`,
  ]);
  return { ...ctx, customers, projects, requests, can_write: ctx.owner || ['company_admin', 'sales', 'sales_manager', 'sales_admin'].includes(ctx.role) };
}

export async function createBuyerRequest(sql: Sql, actor: Actor, input: unknown, asOwner = false) {
  const c = requestInput.parse(input);
  const ctx = await access(sql, actor, c.company_id, 'leads.write', asOwner);
  if (!(ctx.owner || ['company_admin', 'sales', 'sales_manager', 'sales_admin'].includes(ctx.role))) throw new ServiceError('FORBIDDEN', 403);
  const customer = await sql`SELECT id FROM crm_customers WHERE company_id=${c.company_id} AND id=${c.customer_id}`;
  if (!customer.length) throw new ServiceError('INVALID_CUSTOMER', 400);
  const budgetMinor = c.max_budget ? Math.round(Number(c.max_budget) * 100) : null;
  const existing = c.id ? await sql`SELECT id FROM buyer_requests WHERE company_id=${c.company_id} AND id=${c.id}` : [];
  const rows = c.id && existing.length
    ? await sql`UPDATE buyer_requests SET project_id=${c.project_id || null}::uuid,unit_category=${c.unit_category},min_area=${c.min_area || null}::numeric,max_area=${c.max_area || null}::numeric,max_budget_minor=${budgetMinor},payment_plan_code=${c.payment_plan_code},notes=${c.notes},updated_at=now() WHERE company_id=${c.company_id} AND id=${c.id} RETURNING *`
    : await sql`INSERT INTO buyer_requests(company_id,customer_id,project_id,unit_category,min_area,max_area,max_budget_minor,payment_plan_code,notes,created_by) VALUES(${c.company_id},${c.customer_id},${c.project_id || null}::uuid,${c.unit_category},${c.min_area || null}::numeric,${c.max_area || null}::numeric,${budgetMinor},${c.payment_plan_code},${c.notes},${actor.userId}) RETURNING *`;
  if (!rows.length) throw new ServiceError('NOT_FOUND', 404);
  const matches = await matchRows(sql, c.company_id, c);
  await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},${c.id ? 'crm.buyer_request_updated' : 'crm.buyer_request_created'},${JSON.stringify(rows[0])}::jsonb)`;
  return { request: rows[0], matches };
}

export async function buyerRequestMatches(sql: Sql, actor: Actor, companyId: string, requestId: string, asOwner = false) {
  await access(sql, actor, companyId, 'leads.read', asOwner);
  const request = (await sql`SELECT id,customer_id,project_id,unit_category,min_area::text,max_area::text,max_budget_minor::text,payment_plan_code,notes,status FROM buyer_requests WHERE company_id=${companyId} AND id=${requestId}`)[0];
  if (!request) throw new ServiceError('NOT_FOUND', 404);
  const matches = await matchRows(sql, companyId, { project_id: request.project_id, unit_category: request.unit_category, min_area: request.min_area, max_area: request.max_area, max_budget: request.max_budget_minor ? (Number(request.max_budget_minor) / 100).toFixed(2) : null, payment_plan_code: request.payment_plan_code });
  if (matches.length && request.status === 'open') await sql`UPDATE buyer_requests SET status='matched',updated_at=now() WHERE company_id=${companyId} AND id=${requestId}`;
  return { request, matches };
}
