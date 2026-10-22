-- Financial period locks, immutable posted ledger reversals and reconciliation protection.
-- Locks and reversals are company/legal-entity scoped and require authorized finance managers.
BEGIN;
CREATE TABLE ledger_period_locks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 date_from date NOT NULL,
 date_to date NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 locked_by text NOT NULL,
 locked_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id),
 CHECK(date_to>=date_from)
);
CREATE INDEX ledger_period_lookup ON ledger_period_locks(company_id,entity_id,date_from,date_to);

CREATE TABLE ledger_reversals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 original_entry_id uuid NOT NULL,
 reversal_entry_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 reversed_by text NOT NULL,
 reversed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,original_entry_id),
 UNIQUE(company_id,entity_id,reversal_entry_id),
 FOREIGN KEY(company_id,entity_id,original_entry_id) REFERENCES ledger_entries(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,reversal_entry_id) REFERENCES ledger_entries(company_id,entity_id,id),
 CHECK(original_entry_id<>reversal_entry_id)
);

CREATE FUNCTION bunyra_ledger_period_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $ledgerperiod$
BEGIN
 -- Serialize a new/posted journal against closing the legal entity's period.
 PERFORM 1 FROM ledger_entities WHERE company_id=NEW.company_id AND id=NEW.entity_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM ledger_period_locks p WHERE p.company_id=NEW.company_id
  AND p.entity_id=NEW.entity_id AND NEW.entry_date BETWEEN p.date_from AND p.date_to)
 THEN RAISE EXCEPTION 'LEDGER_PERIOD_LOCKED' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $ledgerperiod$;
CREATE TRIGGER ledger_period_prevent_new_entries BEFORE INSERT ON ledger_entries
 FOR EACH ROW EXECUTE FUNCTION bunyra_ledger_period_write_guard();
CREATE TRIGGER ledger_period_prevent_entry_changes BEFORE UPDATE OF entry_date,state ON ledger_entries
 FOR EACH ROW EXECUTE FUNCTION bunyra_ledger_period_write_guard();

CREATE FUNCTION bunyra_lock_ledger_period(p_company uuid,p_entity uuid,p_start date,p_end date,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $ledgerlock$
DECLARE who text; result uuid;
BEGIN
 IF p_company IS DISTINCT FROM bunyra_tenant_company()
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
 AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who AND active
  AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF p_end<p_start OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
 THEN RAISE EXCEPTION 'LEDGER_INVALID_PERIOD' USING ERRCODE='P0001';END IF;
 PERFORM 1 FROM ledger_entities WHERE company_id=p_company AND id=p_entity AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_ENTITY_NOT_FOUND' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM ledger_period_locks WHERE company_id=p_company AND entity_id=p_entity
  AND daterange(date_from,date_to,'[]') && daterange(p_start,p_end,'[]'))
 THEN RAISE EXCEPTION 'LEDGER_PERIOD_OVERLAP' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM ledger_entries WHERE company_id=p_company AND entity_id=p_entity
  AND entry_date BETWEEN p_start AND p_end AND state<>'posted')
 THEN RAISE EXCEPTION 'LEDGER_PERIOD_DRAFTS' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM finance_events WHERE company_id=p_company
  AND event_at::date BETWEEN p_start AND p_end AND status='pending')
 THEN RAISE EXCEPTION 'LEDGER_PERIOD_PENDING_EVENTS' USING ERRCODE='P0001';END IF;
 INSERT INTO ledger_period_locks(company_id,entity_id,date_from,date_to,reason,locked_by)
 VALUES(p_company,p_entity,p_start,p_end,p_reason,who) RETURNING id INTO result;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(
  p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),
  'ledger.period_locked',jsonb_build_object('entity_id',p_entity,'date_from',p_start,'date_to',p_end,'lock_id',result));
 RETURN result;
END $ledgerlock$;

CREATE FUNCTION bunyra_reverse_ledger_entry(p_company uuid,p_original uuid,p_date date,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $ledgerreverse$
DECLARE original ledger_entries%ROWTYPE; who text; reversal_id uuid;existing uuid;stamp text;
BEGIN
 IF p_company IS DISTINCT FROM bunyra_tenant_company()
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
 AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who AND active
  AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF length(trim(p_reason)) NOT BETWEEN 3 AND 500
 THEN RAISE EXCEPTION 'LEDGER_INVALID_REVERSAL_REASON' USING ERRCODE='P0001';END IF;
 SELECT * INTO original FROM ledger_entries WHERE company_id=p_company AND id=p_original FOR UPDATE;
 IF NOT FOUND OR original.state<>'posted'
 THEN RAISE EXCEPTION 'LEDGER_NOT_POSTED' USING ERRCODE='P0001'; END IF;
 IF original.source_type<>'manual' THEN RAISE EXCEPTION 'LEDGER_SOURCE_REVERSAL_REQUIRED' USING ERRCODE='P0001'; END IF;
 SELECT reversal_entry_id INTO existing FROM ledger_reversals
 WHERE company_id=p_company AND entity_id=original.entity_id AND original_entry_id=p_original;
 IF FOUND THEN RETURN existing; END IF;
 IF EXISTS(SELECT 1 FROM ledger_reversals WHERE company_id=p_company AND entity_id=original.entity_id
  AND reversal_entry_id=p_original)
 THEN RAISE EXCEPTION 'LEDGER_REVERSAL_OF_REVERSAL' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM treasury_bank_matches m JOIN ledger_lines l ON l.id=m.ledger_line_id
  WHERE l.company_id=p_company AND l.entity_id=original.entity_id AND l.entry_id=p_original)
 THEN RAISE EXCEPTION 'LEDGER_RECONCILED_LOCK' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM ledger_period_locks WHERE company_id=p_company AND entity_id=original.entity_id
  AND p_date BETWEEN date_from AND date_to)
 THEN RAISE EXCEPTION 'LEDGER_PERIOD_LOCKED' USING ERRCODE='P0001';END IF;
 stamp:=encode(sha256(convert_to(original.id::text||p_date::text||trim(p_reason),'UTF8')),'hex');
 INSERT INTO ledger_entries(company_id,entity_id,journal_id,entry_date,reference,description,
  source_type,source_event,idempotency_key,payload_hash,created_by)
 VALUES(original.company_id,original.entity_id,original.journal_id,p_date,
  left('REV:'||original.reference,200),left(trim(p_reason),1000),
  'manual','manual','reversal:'||original.id::text,stamp,who)
 RETURNING id INTO reversal_id;
 INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,project_id,cost_center_id,
    customer_id,contract_id,vendor_id,description,debit_minor,credit_minor)
 SELECT company_id,entity_id,reversal_id,line_number,account_id,project_id,cost_center_id,
    customer_id,contract_id,vendor_id,left('Reversal: '||description,500),credit_minor,debit_minor
 FROM ledger_lines WHERE company_id=p_company AND entity_id=original.entity_id AND entry_id=p_original;
 PERFORM bunyra_ledger_post_entry(p_company,reversal_id);
 INSERT INTO ledger_reversals(company_id,entity_id,original_entry_id,reversal_entry_id,reason,reversed_by)
 VALUES(p_company,original.entity_id,p_original,reversal_id,p_reason,who);
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(
  p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),
  'ledger.entry_reversed',jsonb_build_object('original_entry_id',p_original,'reversal_entry_id',reversal_id,'reason',p_reason));
 RETURN reversal_id;
END $ledgerreverse$;
REVOKE ALL ON FUNCTION bunyra_lock_ledger_period(uuid,uuid,date,date,text),
 bunyra_reverse_ledger_entry(uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_lock_ledger_period(uuid,uuid,date,date,text),
 bunyra_reverse_ledger_entry(uuid,uuid,date,text) TO bunyra_tenant;
DO $ledgerRls$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['ledger_period_locks','ledger_reversals'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY tenant_scope ON public.%I TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()))',n);
  EXECUTE format('GRANT SELECT ON public.%I TO bunyra_tenant',n);
 END LOOP;
END $ledgerRls$;
INSERT INTO schema_migrations(version) VALUES('043-ledger-period-controls');
COMMIT;
