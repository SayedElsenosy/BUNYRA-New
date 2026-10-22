-- Company-local posting dates and strict cash/advance account categories.
BEGIN;
CREATE OR REPLACE FUNCTION bunyra_post_finance_event(p_company uuid,p_event uuid)
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

INSERT INTO schema_migrations(version) VALUES('052-finance-posting-context');
COMMIT;
