import { z } from 'zod';
import { access, ServiceError, uuid, type Actor, type Sql } from './service';
import type { PlanStorage } from './plan-files';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const documentKinds = z.enum(['id_card','payment_proof']);
const adjustmentInput = z.object({ company_id: uuid, contract_id: uuid, installment_id: uuid.nullable().optional(), collection_id: uuid.nullable().optional(), kind: z.enum(['refund','reversal','settlement']), amount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/), reason: z.string().trim().min(3).max(1000), reference: z.string().trim().max(120).default('') }).strict();
const adjustmentAction = z.object({ company_id: uuid, adjustment_id: uuid }).strict();

function hash(bytes: Uint8Array) { return crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>).then(x => Array.from(new Uint8Array(x), b => b.toString(16).padStart(2,'0')).join('')); }
function safeName(name: string) { return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'document'; }

export async function uploadBookingDocument(sql: Sql, actor: Actor, company: string, booking: string, kind: string, file: File, storage: PlanStorage & { remove?(key: string): Promise<void> }, platform = false) {
  const documentKind = documentKinds.parse(kind); await access(sql, actor, company, 'bookings.create', platform);
  if (file.size < 1 || file.size > MAX_DOCUMENT_BYTES) throw new ServiceError('INVALID_FILE_SIZE', 413);
  const allowed = new Set(['image/jpeg','image/png','image/webp','application/pdf']); if (!allowed.has(file.type)) throw new ServiceError('UNSUPPORTED_FILE', 400);
  const row = (await sql`SELECT id,project_id,unit_id FROM bookings WHERE company_id=${company} AND id=${booking}`)[0]; if (!row) throw new ServiceError('NOT_FOUND',404);
  const bytes = new Uint8Array(await file.arrayBuffer()), digest = await hash(bytes), id = crypto.randomUUID(), key = `${company}/bookings/${booking}/${documentKind}-${id}-${safeName(file.name)}`;
  const previous = (await sql`SELECT object_key FROM booking_documents WHERE company_id=${company} AND booking_id=${booking} AND kind=${documentKind}`)[0];
  await storage.put(key, bytes, file.type);
  try {
    await sql.transaction([
      sql`INSERT INTO booking_documents(id,company_id,booking_id,kind,original_name,mime_type,file_size,sha256,object_key,created_by) VALUES(${id},${company},${booking},${documentKind},${file.name},${file.type},${file.size},${digest},${key},${actor.userId}) ON CONFLICT(company_id,booking_id,kind) DO UPDATE SET id=excluded.id,original_name=excluded.original_name,mime_type=excluded.mime_type,file_size=excluded.file_size,sha256=excluded.sha256,object_key=excluded.object_key,status='ready',created_by=excluded.created_by,created_at=now()`,
      documentKind === 'id_card' ? sql`UPDATE bookings SET id_document_key=${key},updated_at=now() WHERE company_id=${company} AND id=${booking}` : sql`UPDATE bookings SET payment_proof_key=${key},updated_at=now() WHERE company_id=${company} AND id=${booking}`,
      sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${company},${actor.userId},${actor.email},'booking.document_uploaded',jsonb_build_object('booking_id',${booking}::text,'kind',${documentKind},'sha256',${digest},'file_size',${file.size}))`,
    ]);
  } catch (error) { await storage.remove?.(key); throw error; }
  if (previous?.object_key && previous.object_key !== key) await storage.remove?.(previous.object_key);
  return { id, kind: documentKind, original_name: file.name, file_size: file.size, sha256: digest };
}

export async function downloadBookingDocument(sql: Sql, actor: Actor, company: string, booking: string, document: string, storage: PlanStorage, platform = false) {
  await access(sql, actor, company, 'bookings.read', platform); const row = (await sql`SELECT original_name,mime_type,file_size,sha256,object_key FROM booking_documents WHERE company_id=${company} AND booking_id=${booking} AND id=${document} AND status='ready'`)[0]; if (!row) throw new ServiceError('NOT_FOUND',404);
  const bytes=await storage.get(row.object_key); if(bytes.length!==row.file_size || await hash(bytes)!==row.sha256)throw new ServiceError('FILE_INTEGRITY',503); return { bytes, name: row.original_name, mime: row.mime_type };
}

export async function createAdjustment(sql: Sql, actor: Actor, input: unknown, platform = false) {
  const c=adjustmentInput.parse(input),ctx=await access(sql,actor,c.company_id,'finance.write',platform); if(!ctx.owner&&!['accountant','finance_manager','company_admin'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);
  const amount=BigInt(Math.round(Number(c.amount)*100)); if(amount<=BigInt(0))throw new ServiceError('INVALID_AMOUNT',400);
  const contract=(await sql`SELECT id FROM contracts WHERE company_id=${c.company_id} AND id=${c.contract_id}`)[0]; if(!contract)throw new ServiceError('NOT_FOUND',404);
  if(c.kind==='settlement'&&!c.installment_id)throw new ServiceError('INSTALLMENT_REQUIRED',400); if(c.kind!=='settlement'&&!c.collection_id)throw new ServiceError('COLLECTION_REQUIRED',400);
  if(c.installment_id){const i=(await sql`SELECT id,contract_id,amount_minor,paid_minor FROM contract_installments WHERE company_id=${c.company_id} AND id=${c.installment_id} FOR UPDATE`)[0];if(!i||i.contract_id!==c.contract_id)throw new ServiceError('INVALID_INSTALLMENT',400);if(c.kind==='settlement'&&amount>BigInt(i.amount_minor)-BigInt(i.paid_minor))throw new ServiceError('OVER_SETTLEMENT',409);}
  if(c.collection_id){const col=(await sql`SELECT id,contract_id,installment_id,amount_minor,status FROM collections WHERE company_id=${c.company_id} AND id=${c.collection_id}`)[0];if(!col||col.contract_id!==c.contract_id||col.status!=='confirmed')throw new ServiceError('INVALID_COLLECTION',400);if(amount>BigInt(col.amount_minor))throw new ServiceError('OVER_ADJUSTMENT',409);}
  const row=(await sql`INSERT INTO financial_adjustments(company_id,contract_id,installment_id,collection_id,kind,amount_minor,reason,reference,created_by) VALUES(${c.company_id},${c.contract_id},${c.installment_id||null}::uuid,${c.collection_id||null}::uuid,${c.kind},${amount.toString()}::bigint,${c.reason},${c.reference},${actor.userId}) RETURNING id,status,amount_minor::text`)[0]; await sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'finance.adjustment_requested',to_jsonb(${JSON.stringify(row)}::jsonb))`; return row;
}

export async function approveAdjustment(sql: Sql, actor: Actor, input: unknown, platform = false) {
  const c=adjustmentAction.parse(input),ctx=await access(sql,actor,c.company_id,'finance.approve',platform);if(!ctx.owner&&!['finance_manager','company_admin'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);const row=(await sql`UPDATE financial_adjustments SET status='approved',approved_by=${actor.userId},approved_at=now(),updated_at=now() WHERE company_id=${c.company_id} AND id=${c.adjustment_id} AND status='requested' RETURNING id,status`)[0];if(!row)throw new ServiceError('INVALID_STATUS',409);return row;
}

export async function executeAdjustment(sql: Sql, actor: Actor, input: unknown, platform = false) {
  const c=adjustmentAction.parse(input),ctx=await access(sql,actor,c.company_id,'finance.write',platform);if(!ctx.owner&&!['accountant','finance_manager','company_admin'].includes(ctx.role))throw new ServiceError('FORBIDDEN',403);const a=(await sql`SELECT * FROM financial_adjustments WHERE company_id=${c.company_id} AND id=${c.adjustment_id} FOR UPDATE`)[0];if(!a||a.status!=='approved')throw new ServiceError('INVALID_STATUS',409);
  const amount=BigInt(a.amount_minor); const statements=[sql`SELECT set_config('app.booking_transition','1',true)`];
  if(a.installment_id){const i=(await sql`SELECT * FROM contract_installments WHERE company_id=${c.company_id} AND id=${a.installment_id} FOR UPDATE`)[0];if(!i)throw new ServiceError('NOT_FOUND',404);if(a.kind==='settlement')statements.push(sql`UPDATE contract_installments SET paid_minor=paid_minor+${amount.toString()}::bigint,status=CASE WHEN paid_minor+${amount.toString()}::bigint>=amount_minor THEN 'paid' ELSE 'partial' END WHERE company_id=${c.company_id} AND id=${a.installment_id}`);else statements.push(sql`UPDATE contract_installments SET paid_minor=GREATEST(0,paid_minor-${amount.toString()}::bigint),status=CASE WHEN paid_minor-${amount.toString()}::bigint<=0 THEN 'due' ELSE 'partial' END WHERE company_id=${c.company_id} AND id=${a.installment_id}`);}
  statements.push(sql`UPDATE financial_adjustments SET status='executed',executed_by=${actor.userId},executed_at=now(),updated_at=now() WHERE company_id=${c.company_id} AND id=${c.adjustment_id}`); statements.push(sql`INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(${c.company_id},${actor.userId},${actor.email},'finance.adjustment_executed',jsonb_build_object('adjustment_id',${c.adjustment_id}::text,'kind',${a.kind},'amount_minor',${a.amount_minor}))`); const r=await sql.transaction(statements);return {id:c.adjustment_id,status:'executed',kind:a.kind,amount_minor:a.amount_minor};
}
