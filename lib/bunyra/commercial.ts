import { z } from 'zod';
import { access, ServiceError, uuid, type Actor, type Sql } from './service';
import { minorUnits } from './projects';
import { calculateApprovedPayment, majorAmount } from './pricing-calculator';
import { unitPricing } from './pricing';

const bookingInput = z.object({ company_id: uuid, project_id: uuid, unit_id: uuid, customer_id: uuid, lead_id: uuid.nullable().optional(), plan_id: uuid, customer_name: z.string().trim().min(2).max(200), customer_phone: z.string().trim().min(3).max(50), customer_email: z.string().trim().email().or(z.literal('')).default(''), correspondence_address: z.string().trim().max(500).default(''), id_document_key: z.string().trim().max(500).default(''), payment_proof_key: z.string().trim().max(500).default(''), reservation_amount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/), notes: z.string().trim().max(2000).default(''), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const offerInput = z.object({ company_id: uuid, project_id: uuid, unit_id: uuid, plan_id: uuid, customer_id: uuid.nullable().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), language: z.enum(['ar', 'en']).default('ar') }).strict();
const collectionInput = z.object({ company_id: uuid, contract_id: uuid, installment_id: uuid, amount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/), reference: z.string().trim().max(120).default('') }).strict();

async function approvedQuote(sql: Sql, actor: Actor, c: { company_id: string; project_id: string; unit_id: string; plan_id: string; date: string }, platform = false) {
  const data = await unitPricing(sql, actor, c.company_id, c.project_id, c.unit_id, platform);
  if (!data.approved) throw new ServiceError('PRICE_NOT_APPROVED', 409);
  const plan = data.plans?.find(p => p.id === c.plan_id);
  if (!plan) throw new ServiceError('PLAN_NOT_ALLOWED', 403);
  const calculation = calculateApprovedPayment(majorAmount(data.price_minor!), plan, c.date);
  return { ...data, plan, calculation };
}

async function roleAccess(sql: Sql, actor: Actor, company: string, action: 'bookings.read'|'bookings.create'|'bookings.approve'|'bookings.cancel'|'finance.read'|'finance.write'|'contracts.write'|'offers.create', platform: boolean) {
  return access(sql, actor, company, action, platform);
}

export async function commercialOverview(sql: Sql, actor: Actor, company: string, platform = false) {
  const ctx = await roleAccess(sql, actor, company, 'bookings.read', platform);
  const [bookings, contracts, due, customers, projects, units] = await Promise.all([
    sql`SELECT b.id,b.status,b.customer_name,b.customer_phone,b.requested_amount_minor::text,b.reservation_amount_minor::text,b.received_amount_minor::text,b.created_at,b.operations_at,b.accounts_at,u.code AS unit_code,p.name AS project_name FROM bookings b JOIN inventory_units u ON u.company_id=b.company_id AND u.project_id=b.project_id AND u.id=b.unit_id JOIN projects p ON p.company_id=b.company_id AND p.id=b.project_id WHERE b.company_id=${company} ORDER BY b.created_at DESC LIMIT 200`,
    sql`SELECT c.id,c.contract_number,c.status,c.value_final_minor::text,c.signed_at,b.customer_name,u.code AS unit_code FROM contracts c JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id JOIN inventory_units u ON u.company_id=c.company_id AND u.project_id=c.project_id AND u.id=c.unit_id WHERE c.company_id=${company} ORDER BY c.created_at DESC LIMIT 200`,
    sql`SELECT i.id,i.contract_id,i.number,i.due_date,i.amount_minor::text,i.paid_minor::text,i.status,c.contract_number,b.customer_name FROM contract_installments i JOIN contracts c ON c.company_id=i.company_id AND c.id=i.contract_id JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id WHERE i.company_id=${company} AND i.status IN('due','partial') ORDER BY i.due_date LIMIT 200`,
    sql`SELECT id,full_name,phone,email,address FROM crm_customers WHERE company_id=${company} ORDER BY full_name LIMIT 500`,
    sql`SELECT id,name FROM projects WHERE company_id=${company} ORDER BY name`,
    sql`SELECT u.id,u.project_id,u.code,u.building,u.floor,u.category,u.area::text,b.id AS book_id,p.id AS plan_id,p.code AS plan_code,p.name AS plan_name FROM inventory_units u JOIN project_pricing pp ON pp.company_id=u.company_id AND pp.project_id=u.project_id JOIN price_books b ON b.company_id=pp.company_id AND b.project_id=pp.project_id AND b.id=pp.book_id AND b.status='approved' JOIN price_book_entries e ON e.company_id=u.company_id AND e.project_id=u.project_id AND e.book_id=b.id AND e.unit_id=u.id AND e.source_unit_version=u.version JOIN price_book_entry_plans ep ON ep.company_id=e.company_id AND ep.project_id=e.project_id AND ep.book_id=e.book_id AND ep.unit_id=e.unit_id JOIN price_book_plans p ON p.company_id=ep.company_id AND p.project_id=ep.project_id AND p.book_id=ep.book_id AND p.id=ep.plan_id WHERE u.company_id=${company} AND u.active AND u.status='available' ORDER BY u.code LIMIT 500`,
  ]);
  return { ...ctx, bookings, contracts, due, customers, projects, units, can_create: ctx.owner || ['sales','sales_manager','sales_admin','company_admin'].includes(ctx.role), can_approve: ctx.owner || ['operations','company_admin'].includes(ctx.role), can_finance: ctx.owner || ['accountant','finance_manager','company_admin'].includes(ctx.role), can_contract: ctx.owner || ['operations','company_admin'].includes(ctx.role) };
}

export async function createOffer(sql: Sql, actor: Actor, input: unknown, platform = false) {
  const c = offerInput.parse(input); await roleAccess(sql, actor, c.company_id, 'offers.create', platform).catch(async () => { await access(sql, actor, c.company_id, 'bookings.create', platform); });
  const quote = await approvedQuote(sql, actor, c);
  const [company, project, unit, customer] = await Promise.all([
    sql`SELECT name,name_en,phone,email,address FROM companies WHERE id=${c.company_id}`,
    sql`SELECT name FROM projects WHERE company_id=${c.company_id} AND id=${c.project_id}`,
    sql`SELECT code,building,floor,category,area::text FROM inventory_units WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND id=${c.unit_id}`,
    c.customer_id ? sql`SELECT full_name,phone,email,address FROM crm_customers WHERE company_id=${c.company_id} AND id=${c.customer_id}` : Promise.resolve([]),
  ]);
  if (!company.length || !project.length || !unit.length) throw new ServiceError('NOT_FOUND', 404);
  return { company: company[0], project: project[0], unit: unit[0], customer: customer[0] || null, quote: { book: quote.book, plan: quote.plan, calculation: quote.calculation }, salesperson: { name: actor.email, email: actor.email }, language: c.language };
}

export async function createBooking(sql: Sql, actor: Actor, input: unknown, platform = false) {
  const c = bookingInput.parse(input); const ctx = await roleAccess(sql, actor, c.company_id, 'bookings.create', platform); if (!ctx.owner && !['sales','sales_manager','sales_admin','company_admin'].includes(ctx.role)) throw new ServiceError('FORBIDDEN',403);
  const quote = await approvedQuote(sql, actor, c);
  const customer = await sql`SELECT id FROM crm_customers WHERE company_id=${c.company_id} AND id=${c.customer_id}`; if (!customer.length) throw new ServiceError('INVALID_CUSTOMER',400);
  const reservation = minorUnits(c.reservation_amount).toString();
  const rows = await sql.transaction([
    sql`SELECT id FROM inventory_units WHERE company_id=${c.company_id} AND project_id=${c.project_id} AND id=${c.unit_id} AND active AND status='available' FOR UPDATE`,
    sql`SELECT bunyra_pricing_assert(NOT EXISTS(SELECT 1 FROM bookings WHERE company_id=${c.company_id} AND unit_id=${c.unit_id} AND status IN('submitted','approved','accounts_pending','accounts_confirmed')),'UNIT_ALREADY_BOOKED')`,
    sql`INSERT INTO bookings(company_id,project_id,unit_id,customer_id,lead_id,book_id,plan_id,customer_name,customer_phone,customer_email,correspondence_address,id_document_key,payment_proof_key,requested_amount_minor,reservation_amount_minor,notes,sales_user_id) VALUES(${c.company_id},${c.project_id},${c.unit_id},${c.customer_id},${c.lead_id || null}::uuid,${quote.book?.id},${c.plan_id},${c.customer_name},${c.customer_phone},${c.customer_email},${c.correspondence_address},${c.id_document_key},${c.payment_proof_key},${quote.calculation.total_minor}::bigint,${reservation}::bigint,${c.notes},${actor.userId}) RETURNING id,status`,
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'booking.submitted',jsonb_build_object('unit_id',${c.unit_id}::text,'amount_minor',${quote.calculation.total_minor}))`,
  ]);
  return { booking: rows[2][0], quote: quote.calculation };
}

export async function updateBooking(sql: Sql, actor: Actor, input: unknown, operation: 'approve'|'reject'|'cancel'|'confirm_receipt', platform = false) {
  const c = z.object({ company_id: uuid, booking_id: uuid, reason: z.string().trim().max(500).default(''), received_amount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).optional() }).strict().parse(input);
  const action = operation === 'approve' ? 'bookings.approve' : operation === 'cancel' ? 'bookings.cancel' : operation === 'confirm_receipt' ? 'finance.write' : 'bookings.approve';
  const ctx = await roleAccess(sql, actor, c.company_id, action, platform);
  if (operation === 'confirm_receipt' && !ctx.owner && !['accountant','finance_manager','company_admin'].includes(ctx.role)) throw new ServiceError('FORBIDDEN',403);
  const row = (await sql`SELECT * FROM bookings WHERE company_id=${c.company_id} AND id=${c.booking_id} FOR UPDATE`)[0]; if (!row) throw new ServiceError('NOT_FOUND',404);
  if (operation === 'approve') {
    if (!['submitted'].includes(row.status)) throw new ServiceError('INVALID_STATUS',409);
    const r = await sql.transaction([sql`SELECT set_config('app.booking_transition','1',true)`,sql`SELECT id FROM inventory_units WHERE company_id=${c.company_id} AND project_id=${row.project_id} AND id=${row.unit_id} AND status='available' FOR UPDATE`,sql`SELECT bunyra_pricing_assert(NOT EXISTS(SELECT 1 FROM bookings WHERE company_id=${c.company_id} AND unit_id=${row.unit_id} AND status IN('approved','accounts_pending','accounts_confirmed')),'UNIT_ALREADY_BOOKED')`,sql`UPDATE bookings SET status='approved',operations_user_id=${actor.userId},operations_at=now(),updated_at=now() WHERE company_id=${c.company_id} AND id=${c.booking_id} RETURNING id,status`,sql`UPDATE inventory_units SET status='reserved',version=version+1,updated_at=now() WHERE company_id=${c.company_id} AND project_id=${row.project_id} AND id=${row.unit_id}`,sql`INSERT INTO unit_status_history(company_id,project_id,unit_id,previous_status,next_status,actor_id) VALUES(${c.company_id},${row.project_id},${row.unit_id},'available','reserved',${actor.userId})`,sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'booking.approved',jsonb_build_object('booking_id',${c.booking_id}::text))`]);return r[3][0];
  }
  if (operation === 'confirm_receipt') { if (!['approved','accounts_pending'].includes(row.status)) throw new ServiceError('INVALID_STATUS',409); const received = minorUnits(c.received_amount || '0').toString(); return (await sql`UPDATE bookings SET status='accounts_confirmed',received_amount_minor=${received}::bigint,accounts_user_id=${actor.userId},accounts_at=now(),updated_at=now() WHERE company_id=${c.company_id} AND id=${c.booking_id} RETURNING id,status,received_amount_minor::text`)[0]; }
  if (operation === 'reject') { if (row.status !== 'submitted') throw new ServiceError('INVALID_STATUS',409); return (await sql`UPDATE bookings SET status='rejected',rejection_reason=${c.reason},updated_at=now() WHERE company_id=${c.company_id} AND id=${c.booking_id} RETURNING id,status`)[0]; }
  if (!['approved','accounts_pending','accounts_confirmed'].includes(row.status)) throw new ServiceError('INVALID_STATUS',409);
  const r = await sql.transaction([sql`SELECT set_config('app.booking_transition','1',true)`,sql`UPDATE bookings SET status='cancelled',cancellation_reason=${c.reason},updated_at=now() WHERE company_id=${c.company_id} AND id=${c.booking_id} RETURNING id,status`,sql`UPDATE inventory_units SET status='available',version=version+1,updated_at=now() WHERE company_id=${c.company_id} AND project_id=${row.project_id} AND id=${row.unit_id} AND status='reserved'`,sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'booking.cancelled',jsonb_build_object('booking_id',${c.booking_id}::text,'reason',${c.reason}))`]);return r[1][0];
}

export async function createContract(sql: Sql, actor: Actor, input: unknown, platform = false) {
  const c = z.object({ company_id: uuid, booking_id: uuid, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(input); const ctx = await roleAccess(sql, actor, c.company_id, 'contracts.write', platform); if (!ctx.owner && !['operations','company_admin'].includes(ctx.role)) throw new ServiceError('FORBIDDEN',403);
  const b = (await sql`SELECT * FROM bookings WHERE company_id=${c.company_id} AND id=${c.booking_id}`)[0]; if (!b || !['approved','accounts_pending','accounts_confirmed'].includes(b.status)) throw new ServiceError('INVALID_STATUS',409);
  const quote = await approvedQuote(sql, actor, { company_id: c.company_id, project_id: b.project_id, unit_id: b.unit_id, plan_id: b.plan_id, date: c.date });
  const number = `BUN-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
  const r = await sql.transaction([sql`INSERT INTO contracts(company_id,booking_id,customer_id,project_id,unit_id,contract_number,value_final_minor,payment_plan_snapshot,created_by) VALUES(${c.company_id},${c.booking_id},${b.customer_id},${b.project_id},${b.unit_id},${number},${quote.calculation.total_minor}::bigint,${JSON.stringify({book:quote.book,plan:quote.plan,calculation:quote.calculation})}::jsonb,${actor.userId}) RETURNING id,contract_number`,sql`INSERT INTO contract_installments(company_id,contract_id,number,due_date,amount_minor) SELECT ${c.company_id},id,(x->>'number')::int,(x->>'due_date')::date,(x->>'amount_minor')::bigint FROM jsonb_array_elements(${JSON.stringify(quote.calculation.installments)}::jsonb) x WHERE id=(SELECT id FROM contracts WHERE company_id=${c.company_id} AND booking_id=${c.booking_id})`,sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'contract.created',jsonb_build_object('booking_id',${c.booking_id}::text,'contract_number',${number}))`]);return { contract:r[0][0], calculation:quote.calculation };
}

export async function recordCollection(sql: Sql, actor: Actor, input: unknown, platform = false) {
  const c = collectionInput.parse(input); const ctx = await roleAccess(sql, actor, c.company_id, 'finance.write', platform); if (!ctx.owner && !['accountant','finance_manager','company_admin'].includes(ctx.role)) throw new ServiceError('FORBIDDEN',403); const amount=minorUnits(c.amount).toString();
  const installment=(await sql`SELECT * FROM contract_installments WHERE company_id=${c.company_id} AND id=${c.installment_id} AND contract_id=${c.contract_id} FOR UPDATE`)[0]; if(!installment)throw new ServiceError('NOT_FOUND',404); const remaining=BigInt(installment.amount_minor)-BigInt(installment.paid_minor); if(BigInt(amount)>remaining)throw new ServiceError('OVER_COLLECTION',409);
  const r=await sql.transaction([sql`INSERT INTO collections(company_id,contract_id,installment_id,amount_minor,reference,created_by) VALUES(${c.company_id},${c.contract_id},${c.installment_id},${amount}::bigint,${c.reference},${actor.userId}) RETURNING id`,sql`UPDATE contract_installments SET paid_minor=paid_minor+${amount}::bigint,status=CASE WHEN paid_minor+${amount}::bigint>=amount_minor THEN 'paid' ELSE 'partial' END WHERE company_id=${c.company_id} AND id=${c.installment_id} RETURNING id,status,paid_minor::text`,sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'collection.confirmed',jsonb_build_object('contract_id',${c.contract_id}::text,'amount_minor',${amount}))`]);return {collection:r[0][0],installment:r[1][0]};
}
