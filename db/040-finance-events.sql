-- Accounting bridge: transactional domain events and explicitly configured cash/advance posting.
-- New events are enqueued by database triggers within the original commercial transaction.
-- Booking receipt reallocated at contract signing must NEVER be recorded as a second receipt.
BEGIN;
CREATE TABLE finance_account_mappings(
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 journal_id uuid NOT NULL,
 cash_account_id uuid NOT NULL,
 advance_account_id uuid NOT NULL,
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,entity_id),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id),
 FOREIGN KEY(company_id,entity_id,journal_id) REFERENCES ledger_journals(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,cash_account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,advance_account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 CHECK(cash_account_id<>advance_account_id)
);

CREATE TABLE finance_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 source_kind text NOT NULL CHECK(source_kind IN('booking','contract','collection','adjustment','commission')),
 source_id uuid NOT NULL,
 event_type text NOT NULL CHECK(length(trim(event_type)) BETWEEN 5 AND 80),
 processing_kind text NOT NULL CHECK(processing_kind IN('cash_received','cash_refunded','informational')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','posted','informational')),
 project_id uuid,
 customer_id uuid,
 contract_id uuid,
 amount_minor bigint NOT NULL CHECK(amount_minor>=0),
 event_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload)='object'),
 ledger_entity_id uuid,
 ledger_entry_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 posted_at timestamptz,
 UNIQUE(company_id,source_kind,source_id,event_type),
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),
 FOREIGN KEY(company_id,customer_id) REFERENCES crm_customers(company_id,id),
 FOREIGN KEY(company_id,contract_id) REFERENCES contracts(company_id,id),
 FOREIGN KEY(company_id,ledger_entity_id,ledger_entry_id) REFERENCES ledger_entries(company_id,entity_id,id),
 CHECK((status='posted' AND ledger_entity_id IS NOT NULL AND ledger_entry_id IS NOT NULL AND posted_at IS NOT NULL)
     OR (status<>'posted' AND ledger_entity_id IS NULL AND ledger_entry_id IS NULL AND posted_at IS NULL)),
 CHECK((processing_kind='informational' AND status='informational')
       OR (processing_kind<>'informational' AND status IN('pending','posted')))
);
CREATE INDEX finance_events_pending ON finance_events(company_id,created_at,id) WHERE status='pending';
CREATE INDEX finance_events_by_customer ON finance_events(company_id,customer_id,created_at DESC);

-- Trigger executes as database owner after a validated business document is written.
-- Tenant RLS is still enforced on caller CRUD; no user can forge finance events.
CREATE FUNCTION bunyra_capture_finance_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event_name text; processing text; money bigint; project uuid; customer uuid; contract uuid; meta jsonb;
BEGIN
 IF TG_TABLE_NAME='bookings' THEN
  IF TG_OP<>'UPDATE' OR NEW.status=OLD.status THEN RETURN NEW; END IF;
  IF NEW.status='accounts_confirmed' AND NEW.received_amount_minor>0 THEN
   event_name:='booking_receipt_confirmed'; processing:='cash_received'; money:=NEW.received_amount_minor;
  ELSIF NEW.status='cancelled' THEN
   event_name:='booking_cancelled'; processing:='informational'; money:=0;
  ELSE RETURN NEW; END IF;
  project:=NEW.project_id; customer:=NEW.customer_id; contract:=NULL;
  meta:=jsonb_build_object('booking_id',NEW.id,'receipt_amount_minor',NEW.received_amount_minor,'status',NEW.status);
 ELSIF TG_TABLE_NAME='contracts' THEN
  IF TG_OP<>'INSERT' THEN RETURN NEW; END IF;
  event_name:='contract_signed'; processing:='informational'; money:=NEW.value_final_minor;
  project:=NEW.project_id;customer:=NEW.customer_id;contract:=NEW.id;
  meta:=jsonb_build_object('contract_id',NEW.id,'booking_id',NEW.booking_id,'contract_number',NEW.contract_number);
 ELSIF TG_TABLE_NAME='collections' THEN
  IF TG_OP<>'INSERT' OR NEW.status<>'confirmed' THEN RETURN NEW; END IF;
  IF NEW.reference='booking receipt' AND current_setting('app.booking_receipt_allocation',true)='1' THEN
   event_name:='booking_receipt_allocated'; processing:='informational';
  ELSE
   event_name:='collection_confirmed'; processing:='cash_received';
  END IF;
  money:=NEW.amount_minor;
  SELECT c.project_id,c.customer_id INTO project,customer FROM contracts c
   WHERE c.company_id=NEW.company_id AND c.id=NEW.contract_id;
  contract:=NEW.contract_id;
  meta:=jsonb_build_object('collection_id',NEW.id,'installment_id',NEW.installment_id,
      'reference',NEW.reference,'contract_id',NEW.contract_id);
 ELSIF TG_TABLE_NAME='financial_adjustments' THEN
  IF TG_OP<>'UPDATE' OR NEW.status<>'executed' OR OLD.status='executed' THEN RETURN NEW; END IF;
  IF NEW.kind IN('refund','reversal') THEN
   processing:='cash_refunded';
  ELSE
   processing:='informational';
  END IF;
  event_name:='adjustment_'||NEW.kind||'_executed';money:=NEW.amount_minor;
  SELECT c.project_id,c.customer_id INTO project,customer FROM contracts c
    WHERE c.company_id=NEW.company_id AND c.id=NEW.contract_id;
  contract:=NEW.contract_id;
  meta:=jsonb_build_object('adjustment_id',NEW.id,'kind',NEW.kind,'collection_id',NEW.collection_id,'reason',NEW.reason);
 ELSIF TG_TABLE_NAME='commission_ledger' THEN
  IF TG_OP<>'INSERT' THEN RETURN NEW; END IF;
  event_name:='commission_'||NEW.kind;processing:='informational';money:=NEW.amount_minor;
  SELECT c.project_id,c.customer_id INTO project,customer FROM contracts c
   WHERE c.company_id=NEW.company_id AND c.id=NEW.contract_id;
  contract:=NEW.contract_id;
  meta:=jsonb_build_object('commission_entry_id',NEW.id,'kind',NEW.kind,'contract_id',NEW.contract_id);
 ELSE RETURN NEW; END IF;
 INSERT INTO finance_events(company_id,source_kind,source_id,event_type,processing_kind,status,
   project_id,customer_id,contract_id,amount_minor,event_at,payload)
 VALUES(NEW.company_id,
  CASE TG_TABLE_NAME WHEN 'bookings' THEN 'booking'
   WHEN 'contracts' THEN 'contract' WHEN 'collections' THEN 'collection'
   WHEN 'financial_adjustments' THEN 'adjustment' ELSE 'commission' END,
  NEW.id,event_name,processing,
  CASE WHEN processing='informational' THEN 'informational' ELSE 'pending' END,
  project,customer,contract,money,now(),meta)
 ON CONFLICT(company_id,source_kind,source_id,event_type) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_capture_finance_event() FROM PUBLIC;
CREATE TRIGGER finance_booking_events AFTER UPDATE OF status ON bookings
 FOR EACH ROW EXECUTE FUNCTION bunyra_capture_finance_event();
CREATE TRIGGER finance_contract_events AFTER INSERT ON contracts
 FOR EACH ROW EXECUTE FUNCTION bunyra_capture_finance_event();
CREATE TRIGGER finance_collection_events AFTER INSERT ON collections
 FOR EACH ROW EXECUTE FUNCTION bunyra_capture_finance_event();
CREATE TRIGGER finance_adjustment_events AFTER UPDATE OF status ON financial_adjustments
 FOR EACH ROW EXECUTE FUNCTION bunyra_capture_finance_event();
CREATE TRIGGER finance_commission_events AFTER INSERT ON commission_ledger
 FOR EACH ROW EXECUTE FUNCTION bunyra_capture_finance_event();

-- Explicit mapping is necessary: a receipt is a liability (customer advance), not automatically earned revenue.
-- A single SERIALIZED event lock plus the ledger's source uniqueness ensures retries cannot double-post.
CREATE FUNCTION bunyra_post_finance_event(p_company uuid,p_event uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ev finance_events%ROWTYPE; mapping finance_account_mappings%ROWTYPE;
        accounting_entity uuid; entry_id uuid; who text; hash_value text;
        debit_account uuid; credit_account uuid; label text;
BEGIN
 IF p_company IS DISTINCT FROM public.bunyra_tenant_company() THEN
   RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
 AND NOT EXISTS(SELECT 1 FROM memberships
  WHERE company_id=p_company AND user_id=who AND active AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO ev FROM finance_events WHERE company_id=p_company AND id=p_event FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_EVENT_NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF ev.status='posted' THEN RETURN ev.ledger_entry_id; END IF;
 IF ev.status<>'pending' OR ev.processing_kind='informational' OR ev.amount_minor<=0
 THEN RAISE EXCEPTION 'FINANCE_EVENT_NOT_POSTABLE' USING ERRCODE='P0001'; END IF;
 SELECT id INTO accounting_entity FROM ledger_entities
  WHERE company_id=p_company AND is_default AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_ENTITY_REQUIRED' USING ERRCODE='P0001'; END IF;
 SELECT * INTO mapping FROM finance_account_mappings
  WHERE company_id=p_company AND entity_id=accounting_entity;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_MAPPING_REQUIRED' USING ERRCODE='P0001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_journals j WHERE j.company_id=p_company
  AND j.entity_id=accounting_entity AND j.id=mapping.journal_id AND j.active)
 OR NOT EXISTS(SELECT 1 FROM ledger_accounts a WHERE a.company_id=p_company
  AND a.entity_id=accounting_entity AND a.id=mapping.cash_account_id
  AND a.role IN('cash','bank') AND a.active AND a.allow_posting)
 OR NOT EXISTS(SELECT 1 FROM ledger_accounts a WHERE a.company_id=p_company
  AND a.entity_id=accounting_entity AND a.id=mapping.advance_account_id
  AND a.role='customer_advance' AND a.active AND a.allow_posting)
 THEN RAISE EXCEPTION 'FINANCE_MAPPING_INVALID' USING ERRCODE='P0001'; END IF;
 IF ev.processing_kind='cash_received' THEN
  debit_account:=mapping.cash_account_id;credit_account:=mapping.advance_account_id;
 ELSE
  debit_account:=mapping.advance_account_id;credit_account:=mapping.cash_account_id;
 END IF;
 label:=ev.event_type||':'||ev.source_id::text;
 hash_value:=encode(sha256(convert_to(ev.payload::text||ev.amount_minor::text||label,'UTF8')),'hex');
 SELECT id INTO entry_id FROM ledger_entries
   WHERE company_id=p_company AND entity_id=accounting_entity AND source_type=ev.source_kind
   AND source_id=ev.source_id AND source_event=ev.event_type FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO ledger_entries(company_id,entity_id,journal_id,entry_date,reference,
      description,idempotency_key,payload_hash,source_type,source_id,source_event,created_by)
  VALUES(p_company,accounting_entity,mapping.journal_id,ev.event_at::date,
      left(label,200),'Financial event from original business document',
      'finance:'||ev.id::text,hash_value,ev.source_kind,ev.source_id,ev.event_type,who)
  RETURNING id INTO entry_id;
  INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,
      project_id,customer_id,contract_id,description,debit_minor,credit_minor)
  VALUES
    (p_company,accounting_entity,entry_id,1,debit_account,
      ev.project_id,ev.customer_id,ev.contract_id,ev.event_type,ev.amount_minor,0),
    (p_company,accounting_entity,entry_id,2,credit_account,
      ev.project_id,ev.customer_id,ev.contract_id,ev.event_type,0,ev.amount_minor);
 END IF;
 PERFORM bunyra_ledger_post_entry(p_company,entry_id);
 UPDATE finance_events SET status='posted',ledger_entity_id=accounting_entity,
    ledger_entry_id=entry_id,posted_at=now() WHERE company_id=p_company AND id=ev.id;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,COALESCE(
   (SELECT email FROM platform_owner WHERE user_id=who),
   (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),
   'finance.event_posted',jsonb_build_object('event_id',ev.id,'entry_id',entry_id,
    'source_kind',ev.source_kind,'source_id',ev.source_id,'processing_kind',ev.processing_kind));
 RETURN entry_id;
END $$;
REVOKE ALL ON FUNCTION bunyra_post_finance_event(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_post_finance_event(uuid,uuid) TO bunyra_tenant;

ALTER TABLE finance_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_account_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_mapping_tenant ON finance_account_mappings TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
ALTER TABLE finance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_events FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_event_tenant ON finance_events TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT,UPDATE ON finance_account_mappings TO bunyra_tenant;
GRANT SELECT ON finance_events TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('040-finance-events');
COMMIT;
