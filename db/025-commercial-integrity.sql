BEGIN;
-- Preserve the approved terms independently of later inventory/price changes.
ALTER TABLE bookings ADD COLUMN quote_snapshot jsonb;
CREATE OR REPLACE FUNCTION bunyra_protect_committed_unit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.company_id<>OLD.company_id OR NEW.project_id<>OLD.project_id THEN RAISE EXCEPTION 'UNIT_SCOPE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.status IN('pending','reserved','sold') THEN
  IF current_setting('app.booking_transition',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'UNIT_COMMITTED' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_at']) THEN RAISE EXCEPTION 'UNIT_COMMITTED' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE FUNCTION bunyra_booking_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.quote_snapshot IS NOT NULL AND NEW.quote_snapshot IS DISTINCT FROM OLD.quote_snapshot THEN RAISE EXCEPTION 'BOOKING_TERMS_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_terms_immutable BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION bunyra_booking_snapshot_immutable();

-- The contract lock serializes collections and all adjustments in the same order.
CREATE FUNCTION bunyra_execute_adjustment(c uuid,a uuid,actor text,actor_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE adj financial_adjustments; receipt collections; installment contract_installments; contract_key uuid; refunded numeric; remaining bigint;
BEGIN
 SELECT contract_id INTO contract_key FROM financial_adjustments WHERE company_id=c AND id=a;
 IF contract_key IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM id FROM contracts WHERE company_id=c AND id=contract_key FOR UPDATE;
 SELECT * INTO adj FROM financial_adjustments WHERE company_id=c AND id=a FOR UPDATE;
 IF adj.status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
 IF adj.kind IN('refund','reversal') THEN
  SELECT * INTO receipt FROM collections WHERE company_id=c AND id=adj.collection_id FOR UPDATE;
  IF receipt.id IS NULL OR receipt.contract_id<>adj.contract_id OR receipt.status<>'confirmed' THEN RAISE EXCEPTION 'INVALID_COLLECTION'; END IF;
  IF adj.installment_id IS NOT NULL AND adj.installment_id<>receipt.installment_id THEN RAISE EXCEPTION 'INVALID_INSTALLMENT'; END IF;
  SELECT COALESCE(sum(amount_minor),0) INTO refunded FROM financial_adjustments WHERE company_id=c AND collection_id=receipt.id AND status='executed' AND kind IN('refund','reversal');
  IF adj.amount_minor>receipt.amount_minor-refunded THEN RAISE EXCEPTION 'OVER_ADJUSTMENT'; END IF;
  SELECT * INTO installment FROM contract_installments WHERE company_id=c AND id=receipt.installment_id AND contract_id=adj.contract_id FOR UPDATE;
  IF installment.id IS NULL OR installment.paid_minor<adj.amount_minor THEN RAISE EXCEPTION 'OVER_ADJUSTMENT'; END IF;
  remaining=installment.paid_minor-adj.amount_minor;
 ELSE
  SELECT * INTO installment FROM contract_installments WHERE company_id=c AND id=adj.installment_id AND contract_id=adj.contract_id FOR UPDATE;
  IF installment.id IS NULL THEN RAISE EXCEPTION 'INVALID_INSTALLMENT'; END IF;
  IF adj.amount_minor>installment.amount_minor-installment.paid_minor THEN RAISE EXCEPTION 'OVER_SETTLEMENT'; END IF;
  remaining=installment.paid_minor+adj.amount_minor;
 END IF;
 UPDATE contract_installments SET paid_minor=remaining,status=CASE WHEN remaining=0 THEN 'due' WHEN remaining=amount_minor THEN 'paid' ELSE 'partial' END WHERE company_id=c AND id=installment.id;
 UPDATE financial_adjustments SET installment_id=installment.id,status='executed',executed_by=actor,executed_at=now(),updated_at=now() WHERE company_id=c AND id=a AND status='approved';
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(c,actor,actor_email,'finance.adjustment_executed',jsonb_build_object('adjustment_id',a,'kind',adj.kind,'amount_minor',adj.amount_minor));
 RETURN jsonb_build_object('id',a,'status','executed','kind',adj.kind,'amount_minor',adj.amount_minor::text);
END $$;
REVOKE ALL ON FUNCTION bunyra_execute_adjustment(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_execute_adjustment(uuid,uuid,text,text) TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('025-commercial-integrity');
COMMIT;
