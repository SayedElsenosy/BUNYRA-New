-- First accounting slice. No changes to commercial workflows or existing balances.
-- This migration is NOT applied to production by CI; review and test on an isolated branch first.
BEGIN;

CREATE TABLE ledger_entities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 code text NOT NULL CHECK (length(trim(code)) BETWEEN 2 AND 30),
 name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
 is_default boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 UNIQUE(company_id,code)
);
CREATE UNIQUE INDEX ledger_one_default_entity ON ledger_entities(company_id) WHERE is_default;
INSERT INTO ledger_entities(company_id,code,name,is_default)
SELECT id,'MAIN',name,true FROM companies;
CREATE FUNCTION bunyra_ledger_seed_entity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.ledger_entities(company_id,code,name,is_default)
 VALUES(NEW.id,'MAIN',NEW.name,true);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_ledger_seed_entity() FROM PUBLIC;
CREATE TRIGGER ledger_seed_company_entity AFTER INSERT ON companies
FOR EACH ROW EXECUTE FUNCTION bunyra_ledger_seed_entity();

CREATE TABLE ledger_cost_centers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 project_id uuid,
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 2 AND 30),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 160),
 active boolean NOT NULL DEFAULT true,
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,code),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id)
);
CREATE TABLE ledger_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 2 AND 30),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 160),
 kind text NOT NULL CHECK(kind IN('asset','liability','equity','income','expense')),
 role text NOT NULL DEFAULT 'general' CHECK(role IN('general','receivable','payable','cash','bank','customer_advance','tax','clearing')),
 allow_posting boolean NOT NULL DEFAULT true,
 reconcilable boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,code),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id)
);
CREATE TABLE ledger_journals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 2 AND 15),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 160),
 kind text NOT NULL CHECK(kind IN('general','sales','purchase','cash','bank','payroll','adjustment')),
 active boolean NOT NULL DEFAULT true,
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,code),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id)
);
CREATE TABLE ledger_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 journal_id uuid NOT NULL,
 entry_date date NOT NULL,
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 200),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1000),
 currency_code text NOT NULL DEFAULT 'EGP' CHECK(currency_code='EGP'),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','posted')),
 source_type text NOT NULL DEFAULT 'manual' CHECK(source_type IN('manual','booking','contract','collection','adjustment','commission','expense','vendor_bill','payroll','asset')),
 source_id uuid,
 source_event text NOT NULL DEFAULT 'manual' CHECK(length(trim(source_event)) BETWEEN 2 AND 80),
 idempotency_key text NOT NULL CHECK(length(trim(idempotency_key)) BETWEEN 8 AND 128),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 posted_by text,
 posted_at timestamptz,
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,idempotency_key),
 UNIQUE(company_id,entity_id,source_type,source_id,source_event),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id),
 FOREIGN KEY(company_id,entity_id,journal_id) REFERENCES ledger_journals(company_id,entity_id,id),
 CHECK((source_type='manual' AND source_id IS NULL) OR (source_type<>'manual' AND source_id IS NOT NULL)),
 CHECK((state='draft' AND posted_by IS NULL AND posted_at IS NULL) OR (state='posted' AND posted_by IS NOT NULL AND posted_at IS NOT NULL))
);
CREATE INDEX ledger_entries_date ON ledger_entries(company_id,entity_id,entry_date DESC);
CREATE INDEX ledger_entries_source ON ledger_entries(company_id,source_type,source_id);
CREATE TABLE ledger_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 entry_id uuid NOT NULL,
 line_number integer NOT NULL CHECK(line_number>0),
 account_id uuid NOT NULL,
 project_id uuid,
 cost_center_id uuid,
 customer_id uuid,
 contract_id uuid,
 description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
 debit_minor bigint NOT NULL DEFAULT 0 CHECK(debit_minor>=0),
 credit_minor bigint NOT NULL DEFAULT 0 CHECK(credit_minor>=0),
 UNIQUE(company_id,entity_id,entry_id,line_number),
 FOREIGN KEY(company_id,entity_id,entry_id) REFERENCES ledger_entries(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,cost_center_id) REFERENCES ledger_cost_centers(company_id,entity_id,id),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),
 FOREIGN KEY(company_id,customer_id) REFERENCES crm_customers(company_id,id),
 FOREIGN KEY(company_id,contract_id) REFERENCES contracts(company_id,id),
 CHECK((debit_minor>0 AND credit_minor=0) OR (debit_minor=0 AND credit_minor>0))
);
CREATE INDEX ledger_lines_account ON ledger_lines(company_id,entity_id,account_id,entry_id);
CREATE INDEX ledger_lines_project ON ledger_lines(company_id,project_id,entry_id) WHERE project_id IS NOT NULL;
CREATE INDEX ledger_lines_customer ON ledger_lines(company_id,customer_id,entry_id) WHERE customer_id IS NOT NULL;

CREATE FUNCTION bunyra_ledger_entry_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.state='posted' THEN RAISE EXCEPTION 'LEDGER_POSTED_IMMUTABLE' USING ERRCODE='P0001'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.state='posted' THEN RAISE EXCEPTION 'LEDGER_POSTED_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF NEW.company_id<>OLD.company_id OR NEW.entity_id<>OLD.entity_id
  OR NEW.journal_id<>OLD.journal_id OR NEW.source_type<>OLD.source_type
  OR NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.source_event<>OLD.source_event
  OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.payload_hash<>OLD.payload_hash
  OR NEW.created_by<>OLD.created_by OR NEW.currency_code<>OLD.currency_code
 THEN RAISE EXCEPTION 'LEDGER_SOURCE_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF NEW.state='posted' AND current_setting('app.ledger_posting',true) IS DISTINCT FROM '1'
 THEN RAISE EXCEPTION 'LEDGER_USE_POSTING_FUNCTION' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_entry_immutable BEFORE UPDATE OR DELETE ON ledger_entries
 FOR EACH ROW EXECUTE FUNCTION bunyra_ledger_entry_guard();

CREATE FUNCTION bunyra_ledger_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e_state text; linked_project uuid; linked_customer uuid; active_company uuid; active_entity uuid; active_entry uuid;
BEGIN
 IF TG_OP='DELETE' THEN
  active_company:=OLD.company_id; active_entity:=OLD.entity_id; active_entry:=OLD.entry_id;
 ELSE
  active_company:=NEW.company_id; active_entity:=NEW.entity_id; active_entry:=NEW.entry_id;
 END IF;
 SELECT state INTO e_state FROM public.ledger_entries
 WHERE company_id=active_company AND entity_id=active_entity AND id=active_entry FOR SHARE;
 IF e_state IS NULL OR e_state<>'draft' THEN RAISE EXCEPTION 'LEDGER_POSTED_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.entity_id,NEW.entry_id) IS DISTINCT FROM (OLD.company_id,OLD.entity_id,OLD.entry_id)
 THEN RAISE EXCEPTION 'LEDGER_LINE_SCOPE_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF NEW.cost_center_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM ledger_cost_centers c WHERE c.company_id=NEW.company_id AND c.entity_id=NEW.entity_id
  AND c.id=NEW.cost_center_id AND c.project_id IS NOT NULL AND c.project_id IS DISTINCT FROM NEW.project_id
 ) THEN RAISE EXCEPTION 'LEDGER_COST_CENTER_PROJECT_MISMATCH' USING ERRCODE='P0001'; END IF;
 IF NEW.contract_id IS NOT NULL THEN
  SELECT c.project_id,c.customer_id INTO linked_project,linked_customer FROM contracts c
  WHERE c.company_id=NEW.company_id AND c.id=NEW.contract_id;
  IF NEW.project_id IS DISTINCT FROM linked_project OR NEW.customer_id IS DISTINCT FROM linked_customer
  THEN RAISE EXCEPTION 'LEDGER_CONTRACT_DIMENSION_MISMATCH' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_line_draft_only BEFORE INSERT OR UPDATE OR DELETE ON ledger_lines
 FOR EACH ROW EXECUTE FUNCTION bunyra_ledger_line_guard();

-- Account posting role is validated inside bunyra_ledger_post_entry; app access controls still apply.
CREATE FUNCTION bunyra_ledger_post_entry(p_company uuid,p_entry uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e ledger_entries%ROWTYPE; num_lines bigint; debit_total numeric; credit_total numeric; who text;
BEGIN
 IF p_company IS DISTINCT FROM public.bunyra_tenant_company()
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who) AND NOT EXISTS(
  SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who
  AND active AND role IN('company_admin','finance_manager')
 ) THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM ledger_entries WHERE company_id=p_company AND id=p_entry FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF e.state='posted' THEN RETURN e.id; END IF;
 IF NOT EXISTS (SELECT 1 FROM ledger_journals WHERE company_id=e.company_id AND entity_id=e.entity_id AND id=e.journal_id AND active)
 THEN RAISE EXCEPTION 'LEDGER_JOURNAL_INACTIVE' USING ERRCODE='P0001'; END IF;
 SELECT count(*),coalesce(sum(l.debit_minor::numeric),0),coalesce(sum(l.credit_minor::numeric),0)
 INTO num_lines,debit_total,credit_total FROM ledger_lines l
 WHERE l.company_id=e.company_id AND l.entity_id=e.entity_id AND l.entry_id=e.id;
 IF num_lines<2 OR debit_total<=0 OR debit_total<>credit_total
 THEN RAISE EXCEPTION 'LEDGER_UNBALANCED' USING ERRCODE='P0001'; END IF;
 IF EXISTS(
  SELECT 1 FROM ledger_lines l JOIN ledger_accounts a ON
   a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
  WHERE l.company_id=e.company_id AND l.entity_id=e.entity_id AND l.entry_id=e.id
  AND (NOT a.active OR NOT a.allow_posting)
 ) THEN RAISE EXCEPTION 'LEDGER_ACCOUNT_INACTIVE' USING ERRCODE='P0001'; END IF;
 PERFORM set_config('app.ledger_posting','1',true);
 UPDATE ledger_entries SET state='posted',posted_by=who,posted_at=now()
 WHERE company_id=e.company_id AND id=e.id;
 PERFORM set_config('app.ledger_posting','',true);
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(e.company_id,who,
 COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
          (SELECT email FROM memberships WHERE company_id=e.company_id AND user_id=who),''),
 'ledger.entry_posted',jsonb_build_object('entry_id',e.id,'journal_id',e.journal_id,
 'debit_minor',debit_total,'credit_minor',credit_total,'idempotency_key',e.idempotency_key));
 RETURN e.id;
END $$;
REVOKE ALL ON FUNCTION bunyra_ledger_post_entry(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_ledger_post_entry(uuid,uuid) TO bunyra_tenant;

DO $$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['ledger_entities','ledger_cost_centers','ledger_accounts','ledger_journals','ledger_entries','ledger_lines'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_scope ON public.%1$I TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()))',name);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO bunyra_tenant',name);
 END LOOP;
END $$;
GRANT UPDATE(code,name,is_default,active) ON ledger_entities TO bunyra_tenant;
GRANT UPDATE(code,name,active,project_id) ON ledger_cost_centers TO bunyra_tenant;
GRANT UPDATE(code,name,kind,role,allow_posting,reconcilable,active) ON ledger_accounts TO bunyra_tenant;
GRANT UPDATE(code,name,kind,active) ON ledger_journals TO bunyra_tenant;
GRANT UPDATE(entry_date,reference,description) ON ledger_entries TO bunyra_tenant;
GRANT UPDATE(line_number,account_id,project_id,cost_center_id,customer_id,contract_id,description,debit_minor,credit_minor)
 ON ledger_lines TO bunyra_tenant;
GRANT DELETE ON ledger_lines TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('039-ledger-foundation');
COMMIT;
