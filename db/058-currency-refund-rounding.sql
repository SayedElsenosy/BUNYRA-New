BEGIN;
-- Cumulative historical valuation prevents split refunds leaving a rounding residue.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='ledger_lines'::regclass
  AND contype='c' AND pg_get_constraintdef(oid) LIKE '%amount_currency_minor%'
 LOOP EXECUTE format('ALTER TABLE ledger_lines DROP CONSTRAINT %I',item.conname); END LOOP;
END $$;
ALTER TABLE ledger_lines ADD CONSTRAINT ledger_currency_snapshot_balance CHECK(
 (amount_currency_minor IS NULL AND exchange_rate IS NULL AND currency_code='EGP') OR
 (amount_currency_minor IS NOT NULL AND exchange_rate>0 AND currency_code ~ '^[A-Z]{3}$'
  AND abs(round(abs(amount_currency_minor)::numeric*exchange_rate)-greatest(debit_minor,credit_minor))<=CASE WHEN currency_code='EGP' THEN 0 ELSE 1 END
  AND ((amount_currency_minor>0 AND debit_minor>0) OR (amount_currency_minor<0 AND credit_minor>0))));
CREATE OR REPLACE FUNCTION bunyra_finance_currency_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE destination uuid; rate numeric; currency text; original finance_events%ROWTYPE; collection uuid; booking uuid; original_amount bigint; prior_native numeric:=0;
BEGIN
 IF NEW.processing_kind='informational' THEN RETURN NEW; END IF;
 IF NEW.source_kind='booking' THEN
  SELECT payment_account_id,receipt_exchange_rate INTO destination,rate FROM bookings WHERE company_id=NEW.company_id AND id=NEW.source_id;
 ELSIF NEW.source_kind='collection' THEN
  SELECT payment_account_id,receipt_exchange_rate INTO destination,rate FROM collections WHERE company_id=NEW.company_id AND id=NEW.source_id;
 ELSIF NEW.source_kind='adjustment' THEN
  SELECT collection_id INTO collection FROM financial_adjustments WHERE company_id=NEW.company_id AND id=NEW.source_id;
  SELECT * INTO original FROM finance_events WHERE company_id=NEW.company_id AND source_kind='collection' AND source_id=collection AND processing_kind='cash_received';
  IF NOT FOUND THEN
   SELECT c.booking_id INTO booking FROM collections r JOIN contracts c ON c.company_id=r.company_id AND c.id=r.contract_id WHERE r.company_id=NEW.company_id AND r.id=collection;
   SELECT * INTO original FROM finance_events WHERE company_id=NEW.company_id AND source_kind='booking' AND source_id=booking AND processing_kind='cash_received';
  END IF;
  destination:=(original.payload->>'payment_account_id')::uuid;
  rate:=(original.payload->>'exchange_rate')::numeric;
 END IF;
 IF destination IS NOT NULL THEN
  SELECT currency_code INTO currency FROM company_payment_accounts WHERE company_id=NEW.company_id AND id=destination;
  original_amount:=NEW.amount_minor;
  IF NEW.source_kind='adjustment' THEN
   SELECT COALESCE(sum(a.amount_minor),0) INTO prior_native FROM financial_adjustments a
    WHERE a.company_id=NEW.company_id AND a.collection_id=collection AND a.id<>NEW.source_id
     AND a.kind IN('refund','reversal') AND a.status='executed';
   NEW.amount_minor:=(round((prior_native+original_amount)*rate)-round(prior_native*rate))::bigint;
  ELSE
   NEW.amount_minor:=round(original_amount::numeric*rate)::bigint;
  END IF;
  IF NEW.amount_minor<=0 THEN RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE='P0001'; END IF;
  NEW.payload:=NEW.payload||jsonb_build_object('payment_account_id',destination,'currency_code',currency,
   'native_amount_minor',original_amount::text,'exchange_rate',rate::text,'valuation','historical_receipt_rate');
 ELSIF EXISTS(SELECT 1 FROM finance_receipt_controls WHERE company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'PAYMENT_ACCOUNT_REQUIRED' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION bunyra_post_finance_event(p_company uuid,p_event uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ev finance_events%ROWTYPE; mapping finance_account_mappings%ROWTYPE;
        accounting_entity uuid; entry_id uuid; who text; hash_value text;
        debit_account uuid; credit_account uuid; label text;
 destination company_payment_accounts%ROWTYPE; native_amount bigint; rate numeric; native_currency text;
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
 IF ev.payload ? 'payment_account_id' THEN
  SELECT * INTO destination FROM company_payment_accounts WHERE company_id=p_company
   AND entity_id=accounting_entity AND id=(ev.payload->>'payment_account_id')::uuid AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_MAPPING_INVALID' USING ERRCODE='P0001'; END IF;
  mapping.company_id:=p_company;mapping.entity_id:=accounting_entity;
  mapping.cash_account_id:=destination.account_id;mapping.journal_id:=destination.journal_id;
  SELECT advance_account_id INTO mapping.advance_account_id FROM finance_receipt_controls
   WHERE company_id=p_company AND entity_id=accounting_entity;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_MAPPING_REQUIRED' USING ERRCODE='P0001'; END IF;
  native_amount:=(ev.payload->>'native_amount_minor')::bigint;
  rate:=(ev.payload->>'exchange_rate')::numeric;
  native_currency:=ev.payload->>'currency_code';
  IF native_currency IS DISTINCT FROM destination.currency_code OR native_amount<=0 OR rate<=0
    OR abs(round(native_amount::numeric*rate)-ev.amount_minor)>(CASE WHEN ev.processing_kind='cash_refunded' THEN 1 ELSE 0 END)
  THEN RAISE EXCEPTION 'FINANCE_MAPPING_INVALID' USING ERRCODE='P0001'; END IF;
 ELSE
 IF EXISTS(SELECT 1 FROM finance_receipt_controls WHERE company_id=p_company AND entity_id=accounting_entity)
 THEN RAISE EXCEPTION 'PAYMENT_ACCOUNT_REQUIRED' USING ERRCODE='P0001'; END IF;
 SELECT * INTO mapping FROM finance_account_mappings
  WHERE company_id=p_company AND entity_id=accounting_entity;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_MAPPING_REQUIRED' USING ERRCODE='P0001'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_journals j WHERE j.company_id=p_company
  AND j.entity_id=accounting_entity AND j.id=mapping.journal_id AND j.active
   AND EXISTS(SELECT 1 FROM ledger_accounts ca WHERE ca.company_id=p_company AND ca.entity_id=accounting_entity
    AND ca.id=mapping.cash_account_id AND ((ca.role='cash' AND j.kind='cash') OR (ca.role='bank' AND j.kind='bank'))))
 OR NOT EXISTS(SELECT 1 FROM ledger_accounts a WHERE a.company_id=p_company
  AND a.entity_id=accounting_entity AND a.id=mapping.cash_account_id
  AND a.role IN('cash','bank') AND a.kind='asset' AND a.active AND a.allow_posting)
 OR NOT EXISTS(SELECT 1 FROM ledger_accounts a WHERE a.company_id=p_company
  AND a.entity_id=accounting_entity AND a.id=mapping.advance_account_id
  AND a.role='customer_advance' AND a.kind='liability' AND a.active AND a.allow_posting)
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
  VALUES(p_company,accounting_entity,mapping.journal_id,(ev.event_at AT TIME ZONE COALESCE((SELECT time_zone FROM company_settings WHERE company_id=p_company),'Africa/Cairo'))::date,
      left(label,200),'Financial event from original business document',
      'finance:'||ev.id::text,hash_value,ev.source_kind,ev.source_id,ev.event_type,who)
  RETURNING id INTO entry_id;
  INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,
      project_id,customer_id,contract_id,description,debit_minor,credit_minor,currency_code,amount_currency_minor,exchange_rate)
  VALUES
    (p_company,accounting_entity,entry_id,1,debit_account,
      ev.project_id,ev.customer_id,ev.contract_id,ev.event_type,ev.amount_minor,0,COALESCE(native_currency,'EGP'),native_amount,rate),
    (p_company,accounting_entity,entry_id,2,credit_account,
      ev.project_id,ev.customer_id,ev.contract_id,ev.event_type,0,ev.amount_minor,COALESCE(native_currency,'EGP'),-native_amount,rate);
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
CREATE OR REPLACE FUNCTION bunyra_reverse_ledger_entry(p_company uuid,p_original uuid,p_date date,p_reason text)
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
    customer_id,contract_id,vendor_id,description,debit_minor,credit_minor,currency_code,amount_currency_minor,exchange_rate)
 SELECT company_id,entity_id,reversal_id,line_number,account_id,project_id,cost_center_id,
    customer_id,contract_id,vendor_id,left('Reversal: '||description,500),credit_minor,debit_minor,currency_code,-amount_currency_minor,exchange_rate
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
CREATE OR REPLACE FUNCTION bunyra_attempt_finance_event(p_company uuid,p_event uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $attempt$
DECLARE who text; ev finance_events%ROWTYPE; entry uuid; err text; automatic boolean;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 automatic:=COALESCE(current_setting('app.finance_scheduled',true)='1',false)
  OR COALESCE(current_setting('app.finance_automatic',true)='1',false);
 SELECT * INTO ev FROM finance_events WHERE company_id=p_company AND id=p_event FOR UPDATE;
 IF NOT FOUND OR ev.status<>'pending' OR ev.processing_attempts>=8 OR ev.next_attempt_at>now()
 THEN RETURN jsonb_build_object('posted',0,'failed',0); END IF;
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who) AND ev.project_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM member_permissions WHERE company_id=p_company AND user_id=who
    AND project_id=ev.project_id AND action='finance.approve' AND NOT allowed)
  THEN RAISE EXCEPTION 'FINANCE_PROJECT_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  entry:=bunyra_post_finance_event(p_company,ev.id);
  UPDATE finance_events SET processing_attempts=ev.processing_attempts+1,last_attempt_at=now(),last_error_code=NULL
   WHERE company_id=p_company AND id=ev.id;
  INSERT INTO finance_event_attempts(company_id,event_id,attempt_number,outcome,entry_id,automatic,actor_id)
  VALUES(p_company,ev.id,ev.processing_attempts+1,'posted',entry,automatic,who);
  RETURN jsonb_build_object('posted',1,'failed',0);
 EXCEPTION WHEN OTHERS THEN
  err:=CASE WHEN SQLERRM IN('PAYMENT_ACCOUNT_REQUIRED','FINANCE_PROJECT_FORBIDDEN','FINANCE_MAPPING_REQUIRED','FINANCE_MAPPING_INVALID','FINANCE_ENTITY_REQUIRED',
   'LEDGER_PERIOD_LOCKED','LEDGER_ACCOUNT_INACTIVE','LEDGER_JOURNAL_INACTIVE','FINANCE_EVENT_NOT_POSTABLE',
   'LEDGER_CONTRACT_DIMENSION_MISMATCH','LEDGER_COST_CENTER_PROJECT_MISMATCH') THEN SQLERRM ELSE 'POSTING_FAILED' END;
  UPDATE finance_events SET processing_attempts=ev.processing_attempts+1,last_attempt_at=now(),last_error_code=err,
   next_attempt_at=now()+interval '1 minute'*least(60,power(2,least(ev.processing_attempts,6))::integer)
   WHERE company_id=p_company AND id=ev.id;
  INSERT INTO finance_event_attempts(company_id,event_id,attempt_number,outcome,error_code,automatic,actor_id)
  VALUES(p_company,ev.id,ev.processing_attempts+1,'failed',err,automatic,who);
  RETURN jsonb_build_object('posted',0,'failed',1);
 END;
END $attempt$;
INSERT INTO schema_migrations(version) VALUES('058-currency-refund-rounding');
COMMIT;

