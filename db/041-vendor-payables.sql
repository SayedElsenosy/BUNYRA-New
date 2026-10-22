-- Vendor payable subledger, expense/capex coding and immutable GL invoice posting.
-- No payroll, VAT, supplier disbursement or bank reconciliation is represented here.
BEGIN;
CREATE TABLE finance_vendors(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 2 AND 40),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 200),
 tax_registration text NOT NULL DEFAULT '' CHECK(length(tax_registration)<=50),
 active boolean NOT NULL DEFAULT true,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),UNIQUE(company_id,code)
);
CREATE TABLE finance_vendor_bills(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 vendor_id uuid NOT NULL,
 invoice_number text NOT NULL CHECK(length(trim(invoice_number)) BETWEEN 2 AND 100),
 invoice_date date NOT NULL,
 due_date date NOT NULL,
 total_minor bigint NOT NULL CHECK(total_minor>0),
 currency_code text NOT NULL DEFAULT 'EGP' CHECK(currency_code='EGP'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','posted','cancelled')),
 created_by text NOT NULL,
 approved_by text,
 approved_at timestamptz,
 posted_entry_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,vendor_id,invoice_number),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id),
 FOREIGN KEY(company_id,vendor_id) REFERENCES finance_vendors(company_id,id),
 FOREIGN KEY(company_id,entity_id,posted_entry_id) REFERENCES ledger_entries(company_id,entity_id,id),
 CHECK(due_date>=invoice_date),
 CHECK((status='draft' AND approved_by IS NULL AND posted_entry_id IS NULL)
    OR (status='approved' AND approved_by IS NOT NULL AND posted_entry_id IS NULL)
    OR (status='posted' AND approved_by IS NOT NULL AND posted_entry_id IS NOT NULL)
    OR (status='cancelled' AND posted_entry_id IS NULL))
);
CREATE TABLE finance_vendor_bill_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 bill_id uuid NOT NULL,
 line_number integer NOT NULL CHECK(line_number>0),
 expense_account_id uuid NOT NULL,
 project_id uuid,
 cost_center_id uuid,
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 UNIQUE(company_id,entity_id,bill_id,line_number),
 FOREIGN KEY(company_id,entity_id,bill_id) REFERENCES finance_vendor_bills(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,expense_account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,cost_center_id) REFERENCES ledger_cost_centers(company_id,entity_id,id),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id)
);
ALTER TABLE ledger_lines ADD COLUMN vendor_id uuid;
ALTER TABLE ledger_lines ADD CONSTRAINT ledger_line_vendor_fk FOREIGN KEY(company_id,vendor_id) REFERENCES finance_vendors(company_id,id);
CREATE INDEX ledger_lines_vendor ON ledger_lines(company_id,vendor_id,entry_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX vendor_bills_unpaid ON finance_vendor_bills(company_id,entity_id,due_date) WHERE status IN('approved','posted');

CREATE TABLE finance_payable_mappings(
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 journal_id uuid NOT NULL,
 payable_account_id uuid NOT NULL,
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,entity_id),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id),
 FOREIGN KEY(company_id,entity_id,journal_id) REFERENCES ledger_journals(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,payable_account_id) REFERENCES ledger_accounts(company_id,entity_id,id)
);

CREATE FUNCTION bunyra_vendor_bill_header_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status<>'draft' THEN RAISE EXCEPTION 'VENDOR_BILL_IMMUTABLE' USING ERRCODE='P0001'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.status IN('posted','cancelled') THEN RAISE EXCEPTION 'VENDOR_BILL_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF (NEW.company_id,NEW.entity_id,NEW.vendor_id,NEW.invoice_number,NEW.total_minor,NEW.currency_code,NEW.created_by)
   IS DISTINCT FROM
    (OLD.company_id,OLD.entity_id,OLD.vendor_id,OLD.invoice_number,OLD.total_minor,OLD.currency_code,OLD.created_by)
 THEN RAISE EXCEPTION 'VENDOR_BILL_SOURCE_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF NEW.status='posted' AND current_setting('app.vendor_bill_posting',true) IS DISTINCT FROM '1'
 THEN RAISE EXCEPTION 'VENDOR_BILL_USE_POSTING_FUNCTION' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vendor_bill_header_guard BEFORE UPDATE OR DELETE ON finance_vendor_bills
 FOR EACH ROW EXECUTE FUNCTION bunyra_vendor_bill_header_guard();
CREATE FUNCTION bunyra_vendor_bill_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE state text; bill uuid; org uuid; entity uuid;
BEGIN
 IF TG_OP='DELETE' THEN bill:=OLD.bill_id;org:=OLD.company_id;entity:=OLD.entity_id;
 ELSE bill:=NEW.bill_id;org:=NEW.company_id;entity:=NEW.entity_id;END IF;
 SELECT b.status INTO state FROM finance_vendor_bills b WHERE b.company_id=org AND b.entity_id=entity AND b.id=bill FOR SHARE;
 IF state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'VENDOR_BILL_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.entity_id,NEW.bill_id) IS DISTINCT FROM (OLD.company_id,OLD.entity_id,OLD.bill_id)
 THEN RAISE EXCEPTION 'VENDOR_BILL_SOURCE_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF TG_OP<>'DELETE' AND NEW.cost_center_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM ledger_cost_centers c WHERE c.company_id=NEW.company_id AND c.entity_id=NEW.entity_id
    AND c.id=NEW.cost_center_id AND c.project_id IS NOT NULL AND c.project_id IS DISTINCT FROM NEW.project_id
 ) THEN RAISE EXCEPTION 'LEDGER_COST_CENTER_PROJECT_MISMATCH' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vendor_bill_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON finance_vendor_bill_lines
 FOR EACH ROW EXECUTE FUNCTION bunyra_vendor_bill_line_guard();

CREATE FUNCTION bunyra_post_vendor_bill(p_company uuid,p_bill uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bill finance_vendor_bills%ROWTYPE; mapping finance_payable_mappings%ROWTYPE;
      items_total numeric; items_count int; entry_key uuid; who text; hash_value text;
BEGIN
 IF p_company IS DISTINCT FROM public.bunyra_tenant_company()
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
 AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who
   AND active AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT * INTO bill FROM finance_vendor_bills WHERE company_id=p_company AND id=p_bill FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VENDOR_BILL_NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF bill.status='posted' THEN RETURN bill.posted_entry_id; END IF;
 IF bill.status<>'approved' THEN RAISE EXCEPTION 'VENDOR_BILL_NOT_APPROVED' USING ERRCODE='P0001'; END IF;
 SELECT count(*),coalesce(sum(amount_minor::numeric),0) INTO items_count,items_total
 FROM finance_vendor_bill_lines WHERE company_id=p_company AND entity_id=bill.entity_id AND bill_id=bill.id;
 IF items_count<1 OR items_total<>bill.total_minor THEN RAISE EXCEPTION 'VENDOR_BILL_AMOUNT_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT * INTO mapping FROM finance_payable_mappings WHERE company_id=p_company AND entity_id=bill.entity_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_PAYABLE_MAPPING_REQUIRED' USING ERRCODE='P0001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_accounts a WHERE a.company_id=p_company AND a.entity_id=bill.entity_id
    AND a.id=mapping.payable_account_id AND a.role='payable' AND a.active AND a.allow_posting)
 OR NOT EXISTS(SELECT 1 FROM ledger_journals j WHERE j.company_id=p_company AND j.entity_id=bill.entity_id
    AND j.id=mapping.journal_id AND j.active)
 OR EXISTS(
   SELECT 1 FROM finance_vendor_bill_lines l JOIN ledger_accounts a ON
     a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.expense_account_id
   WHERE l.company_id=p_company AND l.entity_id=bill.entity_id AND l.bill_id=bill.id
   AND (NOT a.active OR NOT a.allow_posting OR a.kind NOT IN('expense','asset'))
 )
 THEN RAISE EXCEPTION 'FINANCE_PAYABLE_MAPPING_INVALID' USING ERRCODE='P0001';END IF;
 hash_value:=encode(sha256(convert_to(bill.invoice_number||bill.total_minor::text||bill.vendor_id::text,'UTF8')),'hex');
 SELECT id INTO entry_key FROM ledger_entries
   WHERE company_id=p_company AND entity_id=bill.entity_id AND source_type='vendor_bill'
   AND source_id=bill.id AND source_event='vendor_bill_approved' FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO ledger_entries(company_id,entity_id,journal_id,entry_date,reference,description,
    source_type,source_id,source_event,idempotency_key,payload_hash,created_by)
  VALUES(p_company,bill.entity_id,mapping.journal_id,bill.invoice_date,
   left('AP:'||bill.invoice_number,200),'Vendor bill',
   'vendor_bill',bill.id,'vendor_bill_approved','vendorbill:'||bill.id::text,hash_value,who)
  RETURNING id INTO entry_key;
  INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,project_id,
    cost_center_id,vendor_id,description,debit_minor,credit_minor)
  SELECT l.company_id,l.entity_id,entry_key,l.line_number*2-1,l.expense_account_id,l.project_id,
    l.cost_center_id,bill.vendor_id,l.description,l.amount_minor,0
  FROM finance_vendor_bill_lines l WHERE l.company_id=p_company AND l.entity_id=bill.entity_id AND l.bill_id=bill.id
  UNION ALL
  SELECT l.company_id,l.entity_id,entry_key,l.line_number*2,mapping.payable_account_id,l.project_id,
    l.cost_center_id,bill.vendor_id,'Payable: '||bill.invoice_number,0,l.amount_minor
  FROM finance_vendor_bill_lines l WHERE l.company_id=p_company AND l.entity_id=bill.entity_id AND l.bill_id=bill.id;
 END IF;
 PERFORM bunyra_ledger_post_entry(p_company,entry_key);
 PERFORM set_config('app.vendor_bill_posting','1',true);
 UPDATE finance_vendor_bills SET status='posted',posted_entry_id=entry_key,updated_at=now()
 WHERE company_id=p_company AND id=bill.id;
 PERFORM set_config('app.vendor_bill_posting','',true);
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(
   p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
      (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),
   'finance.vendor_bill_posted',jsonb_build_object('vendor_bill_id',bill.id,'entry_id',entry_key,
      'total_minor',bill.total_minor,'vendor_id',bill.vendor_id));
 RETURN entry_key;
END $$;
REVOKE ALL ON FUNCTION bunyra_post_vendor_bill(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_post_vendor_bill(uuid,uuid) TO bunyra_tenant;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['finance_vendors','finance_vendor_bills','finance_vendor_bill_lines','finance_payable_mappings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON public.%I TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO bunyra_tenant',t);
 END LOOP;
END $$;
GRANT DELETE ON finance_vendor_bill_lines TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('041-vendor-payables');
COMMIT;
