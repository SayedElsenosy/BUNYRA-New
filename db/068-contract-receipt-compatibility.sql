BEGIN;
-- 068: extend the CURRENT contract/installment/collection model.
-- The canonical contracts, contract_installments and collections tables already
-- drive CRM, commission and accounting. Never create duplicate financial ledgers.
CREATE UNIQUE INDEX IF NOT EXISTS contract_installments_scope_id_unique
  ON contract_installments(company_id,contract_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS collections_scope_id_unique
  ON collections(company_id,id);
-- A payment must point to an installment OF THAT contract, not merely of the same company.
ALTER TABLE collections ADD CONSTRAINT collections_contract_installment_scope_fk
  FOREIGN KEY(company_id,contract_id,installment_id)
  REFERENCES contract_installments(company_id,contract_id,id) ON DELETE RESTRICT;

-- A read-only, security-invoker compatibility name for legacy installment readers.
-- All writes continue to contract_installments through the approved engine.
CREATE VIEW installments WITH (security_invoker=true) AS
 SELECT company_id,id,contract_id,number AS sequence,due_date,amount_minor,
        paid_minor,status,created_at FROM contract_installments;
GRANT SELECT ON installments TO bunyra_tenant;

-- A receipt is an immutable financial document, NOT an additional collection.
-- Existing collections continue to be the sole source of confirmed cash.
CREATE TABLE receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 contract_id uuid NOT NULL,
 installment_id uuid NOT NULL,
 collection_id uuid,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 method text NOT NULL CHECK(method IN('CASH','BANK_TRANSFER','CHEQUE','UNSPECIFIED')),
 reference_number text NOT NULL DEFAULT '',
 initial_state text NOT NULL CHECK(initial_state IN('PENDING','CLEARED')),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 UNIQUE(company_id,collection_id),
 FOREIGN KEY(company_id,contract_id) REFERENCES contracts(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,contract_id,installment_id)
  REFERENCES contract_installments(company_id,contract_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,collection_id) REFERENCES collections(company_id,id) ON DELETE RESTRICT,
 CONSTRAINT receipts_lifecycle_guard CHECK (
   (method='CHEQUE' AND initial_state='PENDING' AND collection_id IS NULL
      AND length(btrim(reference_number))>0)
   OR
   (method<>'CHEQUE' AND initial_state='CLEARED' AND collection_id IS NOT NULL)
 )
);
CREATE INDEX receipts_tenant_contract_date_idx ON receipts(company_id,contract_id,created_at DESC);
CREATE UNIQUE INDEX receipts_cheque_reference_unique
 ON receipts(company_id,reference_number)
 WHERE method='CHEQUE';

CREATE TABLE receipt_cheque_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 receipt_id uuid NOT NULL,
 new_state text NOT NULL CHECK(new_state IN('CLEARED','BOUNCED')),
 collection_id uuid,
 reason text NOT NULL DEFAULT '',
 recorded_by text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,receipt_id),
 UNIQUE(company_id,collection_id),
 FOREIGN KEY(company_id,receipt_id) REFERENCES receipts(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,collection_id) REFERENCES collections(company_id,id) ON DELETE RESTRICT,
 CHECK (
   (new_state='BOUNCED' AND collection_id IS NULL AND length(btrim(reason))>0)
   OR (new_state='CLEARED' AND collection_id IS NOT NULL)
 )
);

DO $rls$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['receipts','receipt_cheque_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY tenant_scope ON public.%I TO bunyra_tenant
    USING(company_id=(SELECT bunyra_tenant_company()))
    WITH CHECK(company_id=(SELECT bunyra_tenant_company()))',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',tab);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO bunyra_tenant',tab);
 END LOOP;
END $rls$;

-- Immutable documents and settlement events: corrections need new records.
CREATE FUNCTION bunyra_receipt_append_only() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'RECEIPT_APPEND_ONLY' USING ERRCODE='42501';
END $$;
CREATE TRIGGER receipts_no_mutation BEFORE UPDATE OR DELETE ON receipts
 FOR EACH ROW EXECUTE FUNCTION bunyra_receipt_append_only();
CREATE TRIGGER cheque_events_no_mutation BEFORE UPDATE OR DELETE ON receipt_cheque_events
 FOR EACH ROW EXECUTE FUNCTION bunyra_receipt_append_only();
CREATE TRIGGER receipts_no_truncate BEFORE TRUNCATE ON receipts
 FOR EACH STATEMENT EXECUTE FUNCTION bunyra_receipt_append_only();
CREATE TRIGGER cheque_events_no_truncate BEFORE TRUNCATE ON receipt_cheque_events
 FOR EACH STATEMENT EXECUTE FUNCTION bunyra_receipt_append_only();

-- Check a confirmed instrument truly reflects a real, correctly scoped
-- collection. Do not allow fake receipt amounts or cross-contract allocation.
CREATE FUNCTION bunyra_receipt_validate() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE settled collections%ROWTYPE;
BEGIN
 IF NEW.company_id IS DISTINCT FROM bunyra_tenant_company()
 THEN RAISE EXCEPTION 'RECEIPT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- The authenticated tenant context, not any client-provided label, owns the audit author.
 NEW.created_by:=current_setting('app.user_id',true);
 IF NEW.initial_state='PENDING' AND NOT EXISTS(
   SELECT 1 FROM memberships m WHERE m.company_id=NEW.company_id
     AND m.user_id=NEW.created_by AND m.active
     AND m.role IN('company_admin','accountant','finance_manager')
 ) THEN RAISE EXCEPTION 'RECEIPT_FINANCE_PERMISSION_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NEW.collection_id IS NOT NULL THEN
  SELECT * INTO settled FROM collections
  WHERE company_id=NEW.company_id AND id=NEW.collection_id
  AND contract_id=NEW.contract_id AND installment_id=NEW.installment_id
  AND status='confirmed';
  IF NOT FOUND OR settled.amount_minor IS DISTINCT FROM NEW.amount_minor
  THEN RAISE EXCEPTION 'RECEIPT_COLLECTION_MISMATCH' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipts_validate BEFORE INSERT ON receipts
 FOR EACH ROW EXECUTE FUNCTION bunyra_receipt_validate();

-- Settlements are linked only after the existing collection pipeline has
-- posted the money; this function cannot itself post/reverse any ledger entry.
CREATE FUNCTION bunyra_cheque_event_validate() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r receipts%ROWTYPE;
BEGIN
 IF NEW.company_id IS DISTINCT FROM bunyra_tenant_company()
 THEN RAISE EXCEPTION 'RECEIPT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 NEW.recorded_by:=current_setting('app.user_id',true);
 IF NOT EXISTS(
  SELECT 1 FROM memberships m WHERE m.company_id=NEW.company_id
    AND m.user_id=NEW.recorded_by AND m.active
    AND m.role IN('company_admin','accountant','finance_manager')
 ) THEN RAISE EXCEPTION 'RECEIPT_FINANCE_PERMISSION_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM receipts
 WHERE company_id=NEW.company_id AND id=NEW.receipt_id;
 -- One terminal event per receipt is serialized by the unique index;
 -- receipt documents intentionally grant no UPDATE privileges.
 IF NOT FOUND OR r.method<>'CHEQUE' OR r.initial_state<>'PENDING'
 THEN RAISE EXCEPTION 'INVALID_CHEQUE' USING ERRCODE='23514'; END IF;
 IF NEW.new_state='CLEARED' AND NOT EXISTS(
  SELECT 1 FROM collections c WHERE c.company_id=NEW.company_id
    AND c.id=NEW.collection_id AND c.contract_id=r.contract_id
    AND c.installment_id=r.installment_id AND c.amount_minor=r.amount_minor
    AND c.status='confirmed'
 ) THEN RAISE EXCEPTION 'CHEQUE_COLLECTION_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cheque_events_validate BEFORE INSERT ON receipt_cheque_events
 FOR EACH ROW EXECUTE FUNCTION bunyra_cheque_event_validate();

-- This is a status REPORT, not an authorization to directly change collections.
CREATE VIEW receipt_status WITH (security_invoker=true) AS
 SELECT r.id,r.company_id,r.contract_id,r.installment_id,r.collection_id,
        r.amount_minor,r.method,r.reference_number,r.created_at,
        COALESCE(e.new_state,r.initial_state) AS cheque_state,
        e.collection_id AS cleared_collection_id,e.recorded_at AS resolved_at
 FROM receipts r LEFT JOIN receipt_cheque_events e
 ON e.company_id=r.company_id AND e.receipt_id=r.id;
GRANT SELECT ON receipt_status TO bunyra_tenant;

-- A settlement from the EXISTING commercial/ERP flow receives a receipt
-- in the SAME transaction. Cheques issued in PENDING state remain distinct
-- until the existing collection/ledger system processes actual settlement.
CREATE FUNCTION bunyra_mirror_collection_receipt() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $
DECLARE instrument text;
BEGIN
 SELECT CASE WHEN a.kind='cash' THEN 'CASH'
             WHEN a.kind='bank' THEN 'BANK_TRANSFER'
             ELSE 'UNSPECIFIED' END
 INTO instrument FROM company_payment_accounts a
 WHERE a.company_id=NEW.company_id AND a.id=NEW.payment_account_id;
 INSERT INTO receipts(company_id,contract_id,installment_id,collection_id,
   amount_minor,method,reference_number,initial_state,created_by)
 VALUES(NEW.company_id,NEW.contract_id,NEW.installment_id,NEW.id,NEW.amount_minor,
   COALESCE(instrument,'UNSPECIFIED'),COALESCE(NEW.reference,''),'CLEARED',NEW.created_by)
 ON CONFLICT(company_id,collection_id) DO NOTHING;
 RETURN NEW;
END $;
CREATE TRIGGER collections_mirror_immutable_receipt AFTER INSERT ON collections
 FOR EACH ROW EXECUTE FUNCTION bunyra_mirror_collection_receipt();

INSERT INTO schema_migrations(version) VALUES('068-contract-receipt-compatibility');
COMMIT;
