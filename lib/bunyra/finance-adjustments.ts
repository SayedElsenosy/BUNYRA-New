import { z } from 'zod';
import {minorUnits} from './projects';
import {requireBooking,requireContract} from './record-scope';
import { access, ServiceError, uuid, type Actor, type Sql } from './service';
import type { PlanStorage } from './plan-files';
import { queueAdjustmentNotification } from './notifications';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const documentKinds = z.enum(['id_card','payment_proof']);
const adjustmentInput = z.object({ company_id: uuid, contract_id: uuid, installment_id: uuid.nullable().optional(), collection_id: uuid.nullable().optional(), kind: z.enum(['refund','reversal','settlement']), amount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/), reason: z.string().trim().min(3).max(1000), reference: z.string().trim().max(120).default('') }).strict();
const adjustmentAction = z.object({ company_id: uuid, adjustment_id: uuid }).strict();

function hash(bytes: Uint8Array) { return crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>).then(x => Array.from(new Uint8Array(x), b => b.toString(16).padStart(2,'0')).join('')); }
function safeName(name: string) { return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'document'; }

export async function uploadBookingDocument(sql: Sql, actor: Actor, company: string, booking: string, kind: string, file: File, storage: PlanStorage & { remove?(key: string): Promise<void> }, platform = false) {
  const documentKind = documentKinds.parse(kind); const bookingRow=await requireBooking(sql,actor,company,booking,'bookings.create',platform);
  if(['rejected','cancelled'].includes(bookingRow.status))throw new ServiceError('INVALID_STATUS',409);
  if (file.size < 1 || file.size > MAX_DOCUMENT_BYTES) throw new ServiceError('INVALID_FILE_SIZE', 413);
  const allowed = new Set(['image/jpeg','image/png','image/webp','application/pdf']); if (!allowed.has(file.type)) throw new ServiceError('UNSUPPORTED_FILE', 400);
  const row = (await sql`SELECT id,project_id,unit_id FROM bookings WHERE company_id=${company} AND id=${booking}`)[0]; if (!row) throw new ServiceError('NOT_FOUND',404);
  const bytes = new Uint8Array(await file.arrayBuffer()), digest = await hash(bytes), id = crypto.randomUUID(), key = `${company}/bookings/${booking}/${documentKind}-${id}-${safeName(file.name)}`;
  const previous = (await sql`SELECT object_key FROM booking_documents WHERE company_id=${company} AND booking_id=${booking} AND kind=${documentKind}`)[0];
  await storage.put(key, bytes, file.type);
  try {
    await sql.transaction([
      sql`DELETE FROM booking_documents WHERE company_id=${company}::uuid AND booking_id=${booking}::uuid AND kind=${documentKind}::text`,
      sql`INSERT INTO booking_documents(id,company_id,booking_id,kind,original_name,mime_type,file_size,sha256,object_key,created_by) VALUES(${id}::uuid,${company}::uuid,${booking}::uuid,${documentKind}::text,${file.name}::text,${file.type}::text,${file.size}::integer,${digest}::text,${key}::text,${actor.userId}::text)`,
      documentKind === 'id_card' ? sql`UPDATE bookings SET id_document_key=${key},updated_at=now() WHERE company_id=${company} AND id=${booking}` : sql`UPDATE bookings SET payment_proof_key=${key},updated_at=now() WHERE company_id=${company} AND id=${booking}`,
      sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${company}::uuid,${actor.userId}::text,${actor.email}::text,'booking.document_uploaded',jsonb_build_object('booking_id',${booking}::text,'kind',${documentKind}::text,'sha256',${digest}::text,'file_size',${file.size}::integer))`,
    ]);
  } catch (error) { await storage.remove?.(key); throw error; }
  if (previous?.object_key && previous.object_key !== key) await storage.remove?.(previous.object_key);
  return { id, kind: documentKind, original_name: file.name, file_size: file.size, sha256: digest };
}

export async function downloadBookingDocument(sql: Sql, actor: Actor, company: string, booking: string, document: string, storage: PlanStorage, platform = false) {
  await requireBooking(sql,actor,company,booking,'bookings.read',platform); const row = (await sql`SELECT original_name,mime_type,file_size,sha256,object_key FROM booking_documents WHERE company_id=${company} AND booking_id=${booking} AND id=${document} AND status='ready'`)[0]; if (!row) throw new ServiceError('NOT_FOUND',404);
  const bytes=await storage.get(row.object_key); if(bytes.length!==row.file_size || await hash(bytes)!==row.sha256)throw new ServiceError('FILE_INTEGRITY',503); return { bytes, name: row.original_name, mime: row.mime_type };
}

export async function createAdjustment(sql: Sql, actor: Actor, input: unknown, platform = false) {
  const c=adjustmentInput.parse(input),ctx=await access(sql,actor,c.company_id,'finance.write',platform); if(!ctx.owner&&!['accountant','finance_manager','company_admin'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
  const amount=minorUnits(c.amount); if(amount<=BigInt(0))throw new ServiceError('INVALID_AMOUNT',400);
  const contract=await requireContract(sql,actor,c.company_id,c.contract_id,'finance.write',platform); if(!contract)throw new ServiceError('NOT_FOUND',404);
  if(c.kind==='settlement'&&!c.installment_id)throw new ServiceError('INSTALLMENT_REQUIRED',400); if(c.kind!=='settlement'&&!c.collection_id)throw new ServiceError('COLLECTION_REQUIRED',400);
  if(c.installment_id){const i=(await sql`SELECT id,contract_id,amount_minor,paid_minor FROM contract_installments WHERE company_id=${c.company_id} AND id=${c.installment_id} FOR UPDATE`)[0];if(!i||i.contract_id!==c.contract_id)throw new ServiceError('INVALID_INSTALLMENT',400);if(c.kind==='settlement'&&amount>BigInt(i.amount_minor)-BigInt(i.paid_minor))throw new ServiceError('OVER_SETTLEMENT',409);}
  if(c.collection_id){const col=(await sql`SELECT id,contract_id,installment_id,amount_minor,status FROM collections WHERE company_id=${c.company_id} AND id=${c.collection_id}`)[0];if(!col||col.contract_id!==c.contract_id||col.status!=='confirmed')throw new ServiceError('INVALID_COLLECTION',400);if(c.installment_id&&c.installment_id!==col.installment_id)throw new ServiceError('INVALID_INSTALLMENT',400);c.installment_id=col.installment_id;if(amount>BigInt(col.amount_minor))throw new ServiceError('OVER_ADJUSTMENT',409);}
  const row=(await sql`INSERT INTO financial_adjustments(company_id,contract_id,installment_id,collection_id,kind,amount_minor,reason,reference,created_by) VALUES(${c.company_id},${c.contract_id},${c.installment_id||null}::uuid,${c.collection_id||null}::uuid,${c.kind},${amount.toString()}::bigint,${c.reason},${c.reference},${actor.userId}) RETURNING id,status,amount_minor::text`)[0]; await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'finance.adjustment_requested',to_jsonb(${JSON.stringify(row)}::jsonb))`; return row;
}

export async function approveAdjustment(sql: Sql, actor: Actor, input: unknown, platform = false) {
  const c=adjustmentAction.parse(input),ctx=await access(sql,actor,c.company_id,'finance.approve',platform);if(!ctx.owner&&!['finance_manager','company_admin'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);const adjustment=(await sql`SELECT contract_id FROM financial_adjustments WHERE company_id=${c.company_id} AND id=${c.adjustment_id}`)[0];if(!adjustment)throw new ServiceError('NOT_FOUND',404);await requireContract(sql,actor,c.company_id,adjustment.contract_id,'finance.approve',platform);const row=(await sql`UPDATE financial_adjustments SET status='approved',approved_by=${actor.userId},approved_at=now(),updated_at=now() WHERE company_id=${c.company_id} AND id=${c.adjustment_id} AND status='requested' RETURNING id,status`)[0];if(!row)throw new ServiceError('INVALID_STATUS',409);await queueAdjustmentNotification(sql,c.company_id,c.adjustment_id,'approved');return row;
}

export async function executeAdjustment(sql: Sql, actor: Actor, input: unknown, platform = false) {
  const c=adjustmentAction.parse(input),ctx=await access(sql,actor,c.company_id,'finance.write',platform);if(!ctx.owner&&!['accountant','finance_manager','company_admin'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);const a=(await sql`SELECT * FROM financial_adjustments WHERE company_id=${c.company_id} AND id=${c.adjustment_id} FOR UPDATE`)[0];if(!a||a.status!=='approved')throw new ServiceError('INVALID_STATUS',409);
  await requireContract(sql,actor,c.company_id,a.contract_id,'finance.write',platform);
  const r=await sql`SELECT bunyra_execute_adjustment(${c.company_id}::uuid,${c.adjustment_id}::uuid,${actor.userId}::text,${actor.email}::text) AS result`;
  await queueAdjustmentNotification(sql,c.company_id,c.adjustment_id,'executed');return r[0].result;
}
