BEGIN;
-- Allow a bounced pending cheque to mark a still-unpaid installment overdue.
ALTER TABLE contract_installments DROP CONSTRAINT contract_installments_status_check;
ALTER TABLE contract_installments ADD CONSTRAINT contract_installments_status_check CHECK (status IN ('due','partial','paid','waived','overdue'));
CREATE FUNCTION bunyra_mark_installment_overdue_on_bounce() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $bounce$
DECLARE doc receipts%ROWTYPE;
BEGIN
 IF NEW.new_state <> 'BOUNCED' THEN RETURN NEW; END IF;
 SELECT * INTO doc FROM receipts WHERE company_id=NEW.company_id AND id=NEW.receipt_id;
 IF NOT FOUND OR doc.method <> 'CHEQUE' OR doc.initial_state <> 'PENDING' THEN
  RAISE EXCEPTION 'INVALID_BOUNCED_RECEIPT' USING ERRCODE='23514';
 END IF;
 UPDATE contract_installments i SET status='overdue'
 WHERE i.company_id=doc.company_id AND i.contract_id=doc.contract_id AND i.id=doc.installment_id
  AND i.paid_minor < i.amount_minor AND i.status IN('due','partial');
 RETURN NEW;
END $bounce$;
CREATE TRIGGER cheque_bounce_marks_installment_overdue AFTER INSERT ON receipt_cheque_events
 FOR EACH ROW EXECUTE FUNCTION bunyra_mark_installment_overdue_on_bounce();
CREATE INDEX IF NOT EXISTS installments_aging_due_idx ON contract_installments(company_id,due_date,contract_id) WHERE paid_minor<amount_minor AND status NOT IN('paid','waived');
CREATE INDEX IF NOT EXISTS receipts_treasury_search_idx ON receipts(company_id,created_at DESC,method);
INSERT INTO schema_migrations(version) VALUES('069-treasury-cheque-aging');
COMMIT;
