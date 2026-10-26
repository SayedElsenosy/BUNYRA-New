import 'server-only';
import { z } from 'zod';
import { identity } from './http';
import { access, ServiceError, uuid } from './service';
import { approvedQuote } from './commercial';
import { minorUnits } from './projects';

/**
 * Back-end only. This is the legacy atomic confirmed-booking path adapted to
 * BUNYRA's EXISTING bookings/inventory_units contract. It does not accept
 * company_id, tenant_id, user_id or any client-supplied identity.
 *
 * 'Confirmed' in the legacy engine maps to BUNYRA status 'approved',
 * with inventory_units.status='reserved'. It does NOT confirm receipt or
 * issue a contract. It is restricted to active company admins with BOTH
 * bookings.create and bookings.approve permissions. Ordinary sales continue
 * using the existing request -> operations approval workflow.
 */
const inputSchema = z.object({
  project_id: uuid,
  unit_id: uuid,
  customer_id: uuid,
  plan_id: uuid,
  reservation_amount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(2000).default(''),
}).strict();

export async function createConfirmedBooking(untrustedInput: unknown) {
  const input = inputSchema.parse(untrustedInput);
  // Uses BUNYRA's getCurrentUser(): Neon Auth / verified managed-account cookie.
  // In particular, there is no legacy NextAuth session or tenantId parameter.
  const { sql, actor } = await identity();

  // Resolve the company via ACTIVE DB membership and the requested project's
  // actual owner. The supplied project_id is only a resource locator; it is
  // never treated as a security principal or a way to select a tenant.
  const scope = await sql`SELECT m.company_id
    FROM memberships m JOIN companies c ON c.id=m.company_id
    JOIN projects p ON p.company_id=m.company_id
    WHERE m.user_id=${actor.userId} AND m.active
      AND c.status='active' AND p.id=${input.project_id}::uuid`;
  if (scope.length !== 1) throw new ServiceError('PROJECT_NOT_ACCESSIBLE', 403);
  const companyId = String(scope[0].company_id);

  const create = await access(sql, actor, companyId, 'bookings.create', false, input.project_id);
  const approve = await access(sql, actor, companyId, 'bookings.approve', false, input.project_id);
  if (create.role !== 'company_admin' || approve.role !== 'company_admin')
    throw new ServiceError('APPROVAL_REQUIRED', 403);

  // Reuse BUNYRA's approved price-book and payment plan calculations.
  // Any stale quote is rejected again INSIDE the locked transaction.
  const quote = await approvedQuote(sql, actor, {
    company_id: companyId, project_id: input.project_id,
    unit_id: input.unit_id, plan_id: input.plan_id, date: input.date,
  });
  const customer = (await sql`SELECT id,full_name,phone,email,address
    FROM crm_customers WHERE company_id=${companyId} AND id=${input.customer_id}::uuid`)[0];
  if (!customer) throw new ServiceError('CUSTOMER_NOT_FOUND', 404);
  const reserveMinor = minorUnits(input.reservation_amount).toString();
  if (BigInt(reserveMinor) <= 0n || BigInt(reserveMinor) > BigInt(quote.calculation.down_payment_minor))
    throw new ServiceError('INVALID_AMOUNT', 400);

  const version = quote.unit?.version;
  const snapshot = JSON.stringify({
    book: quote.book, plan: quote.plan,
    calculation: quote.calculation, date: input.date,
    unit: quote.unitSnapshot, geometry: quote.geometrySnapshot,
    source_offer_id: null, source_request_id: null,
  });

  // tenantSql wraps this ONE database transaction with SET LOCAL ROLE
  // bunyra_tenant and SET LOCAL app.company_id/app.user_id. No operator owner
  // connection or unbound query is used to mutate operational records.
  // The SELECT FOR UPDATE serializes concurrent booking attempts on this unit.
  const result = await sql.transaction([
    sql`SELECT id FROM inventory_units
      WHERE company_id=${companyId}::uuid AND project_id=${input.project_id}::uuid
        AND id=${input.unit_id}::uuid FOR UPDATE`,
    sql`SELECT bunyra_pricing_assert(
      EXISTS (
        SELECT 1 FROM inventory_units u
        JOIN project_pricing pp ON pp.company_id=u.company_id AND pp.project_id=u.project_id
        JOIN price_books b ON b.company_id=pp.company_id AND b.project_id=pp.project_id
          AND b.id=pp.book_id AND b.status='approved'
        JOIN price_book_entries e ON e.company_id=u.company_id AND e.project_id=u.project_id
          AND e.book_id=b.id AND e.unit_id=u.id AND e.source_unit_version=u.version
        JOIN price_book_entry_plans ep ON ep.company_id=e.company_id AND ep.project_id=e.project_id
          AND ep.book_id=e.book_id AND ep.unit_id=e.unit_id AND ep.plan_id=${input.plan_id}::uuid
        WHERE u.company_id=${companyId}::uuid AND u.project_id=${input.project_id}::uuid
          AND u.id=${input.unit_id}::uuid AND u.active AND u.status='available'
          AND u.version=${version}
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings WHERE company_id=${companyId}::uuid AND unit_id=${input.unit_id}::uuid
        AND status IN('submitted','approved','accounts_pending','accounts_confirmed')
      ),'UNIT_ALREADY_BOOKED')`,
    sql`INSERT INTO bookings(
      company_id,project_id,unit_id,customer_id,book_id,plan_id,status,
      customer_name,customer_phone,customer_email,correspondence_address,
      requested_amount_minor,reservation_amount_minor,notes,sales_user_id,
      operations_user_id,operations_at,quote_snapshot)
    VALUES (
      ${companyId}::uuid,${input.project_id}::uuid,${input.unit_id}::uuid,${input.customer_id}::uuid,
      ${quote.book?.id}::uuid,${input.plan_id}::uuid,'approved',
      ${customer.full_name},${customer.phone},${customer.email||''},${customer.address||''},
      ${quote.calculation.total_minor}::bigint,${reserveMinor}::bigint,${input.notes},
      ${actor.userId},${actor.userId},now(),${snapshot}::jsonb
    ) RETURNING id,status,unit_id,project_id`,
    sql`SELECT set_config('app.booking_transition','1',true)`,
    sql`UPDATE inventory_units SET status='reserved',version=version+1,updated_at=now()
      WHERE company_id=${companyId}::uuid AND project_id=${input.project_id}::uuid
        AND id=${input.unit_id}::uuid AND status='available'
      RETURNING id,status`,
    sql`INSERT INTO unit_status_history(company_id,project_id,unit_id,previous_status,next_status,actor_id)
      VALUES(${companyId}::uuid,${input.project_id}::uuid,${input.unit_id}::uuid,'available','reserved',${actor.userId})`,
    sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
      VALUES(${companyId}::uuid,${actor.userId},${actor.email},
      'booking.approved',jsonb_build_object('unit_id',${input.unit_id}::text,
      'booking_id', (SELECT id::text FROM bookings WHERE company_id=${companyId}::uuid
       AND unit_id=${input.unit_id}::uuid AND status='approved' ORDER BY created_at DESC LIMIT 1)))`,
  ]);
  // In a failed statement Neon rolls back ALL booked/unit/history/audit changes.
  if (!result[2]?.[0] || !result[4]?.[0]) throw new ServiceError('UNIT_ALREADY_BOOKED',409);
  return { booking: result[2][0], unitStatus: 'reserved' as const, companyId };
}
