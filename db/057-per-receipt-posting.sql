BEGIN;
CREATE OR REPLACE FUNCTION bunyra_initialize_accounting(p_company uuid,p_entity uuid,p_language text,p_treasury text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $template$
DECLARE who text; item record; existing record; n_accounts integer:=0; n_journals integer:=0;
 treasury_account uuid; advances uuid; payable uuid; treasury_journal uuid; purchase_journal uuid;
 existing_mapping finance_account_mappings%ROWTYPE; existing_ap finance_payable_mappings%ROWTYPE;
 changed boolean:=false;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_language IS NULL OR p_language NOT IN('ar','en') OR p_treasury IS NULL OR p_treasury NOT IN('cash','bank','per_transaction')
 THEN RAISE EXCEPTION 'ACCOUNTING_TEMPLATE_INVALID' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('accounting-template:'||p_company::text||':'||p_entity::text,0));
 IF NOT EXISTS(SELECT 1 FROM ledger_entities WHERE company_id=p_company AND id=p_entity AND active AND is_default)
 THEN RAISE EXCEPTION 'FINANCE_ENTITY_REQUIRED' USING ERRCODE='P0001'; END IF;
 FOR item IN SELECT * FROM (VALUES
  ('1110','الصندوق','Cash','asset','cash',true),
  ('1120','البنك','Bank','asset','bank',true),
  ('1130','ذمم العملاء','Customer receivables','asset','receivable',true),
  ('1210','الأصول الثابتة','Fixed assets','asset','general',false),
  ('1220','مجمع الإهلاك','Accumulated depreciation','asset','general',false),
  ('2110','دفعات مقدمة من العملاء','Customer advances','liability','customer_advance',true),
  ('2120','ذمم الموردين','Supplier payables','liability','payable',true),
  ('3110','رأس المال','Capital','equity','general',false),
  ('4110','إيرادات المبيعات','Sales revenue','income','general',false),
  ('5110','مصروفات المشروعات','Project expenses','expense','general',false),
  ('5120','مصروف الإهلاك','Depreciation expense','expense','general',false)
 ) AS v(code,ar,en,kind,role,reconcilable) LOOP
  INSERT INTO ledger_accounts(company_id,entity_id,code,name,kind,role,reconcilable)
  VALUES(p_company,p_entity,item.code,CASE WHEN p_language='ar' THEN item.ar ELSE item.en END,item.kind,item.role,item.reconcilable)
  ON CONFLICT(company_id,entity_id,code) DO NOTHING;
  IF FOUND THEN n_accounts:=n_accounts+1; END IF;
  SELECT * INTO existing FROM ledger_accounts WHERE company_id=p_company AND entity_id=p_entity AND code=item.code FOR SHARE;
  IF existing.kind<>item.kind OR existing.role<>item.role OR NOT existing.active OR NOT existing.allow_posting
  THEN RAISE EXCEPTION 'ACCOUNTING_TEMPLATE_CODE_CONFLICT' USING ERRCODE='P0001'; END IF;
 END LOOP;
 FOR item IN SELECT * FROM (VALUES
  ('CASH','يومية الصندوق','Cash journal','cash'),('BANK','يومية البنك','Bank journal','bank'),
  ('PUR','يومية المشتريات','Purchase journal','purchase'),('GEN','اليومية العامة','General journal','general'),
  ('ADJ','يومية التسويات','Adjustment journal','adjustment')
 ) AS v(code,ar,en,kind) LOOP
  INSERT INTO ledger_journals(company_id,entity_id,code,name,kind)
  VALUES(p_company,p_entity,item.code,CASE WHEN p_language='ar' THEN item.ar ELSE item.en END,item.kind)
  ON CONFLICT(company_id,entity_id,code) DO NOTHING;
  IF FOUND THEN n_journals:=n_journals+1; END IF;
  SELECT * INTO existing FROM ledger_journals WHERE company_id=p_company AND entity_id=p_entity AND code=item.code FOR SHARE;
  IF existing.kind<>item.kind OR NOT existing.active
  THEN RAISE EXCEPTION 'ACCOUNTING_TEMPLATE_CODE_CONFLICT' USING ERRCODE='P0001'; END IF;
 END LOOP;
 SELECT id INTO treasury_account FROM ledger_accounts WHERE company_id=p_company AND entity_id=p_entity
  AND code=CASE WHEN p_treasury='cash' THEN '1110' ELSE '1120' END;
 SELECT id INTO advances FROM ledger_accounts WHERE company_id=p_company AND entity_id=p_entity AND code='2110';
 SELECT id INTO payable FROM ledger_accounts WHERE company_id=p_company AND entity_id=p_entity AND code='2120';
 SELECT id INTO treasury_journal FROM ledger_journals WHERE company_id=p_company AND entity_id=p_entity
  AND code=CASE WHEN p_treasury='cash' THEN 'CASH' ELSE 'BANK' END;
 SELECT id INTO purchase_journal FROM ledger_journals WHERE company_id=p_company AND entity_id=p_entity AND code='PUR';
 IF p_treasury<>'per_transaction' THEN
 SELECT * INTO existing_mapping FROM finance_account_mappings WHERE company_id=p_company AND entity_id=p_entity FOR UPDATE;
 IF FOUND THEN
  IF (existing_mapping.journal_id,existing_mapping.cash_account_id,existing_mapping.advance_account_id)
   IS DISTINCT FROM (treasury_journal,treasury_account,advances)
  THEN RAISE EXCEPTION 'ACCOUNTING_TEMPLATE_MAPPING_CONFLICT' USING ERRCODE='P0001'; END IF;
 ELSE
  INSERT INTO finance_account_mappings(company_id,entity_id,journal_id,cash_account_id,advance_account_id,updated_by)
  VALUES(p_company,p_entity,treasury_journal,treasury_account,advances,who);changed:=true;
 END IF;
 END IF;
 SELECT * INTO existing_ap FROM finance_payable_mappings WHERE company_id=p_company AND entity_id=p_entity FOR UPDATE;
 IF FOUND THEN
  IF (existing_ap.journal_id,existing_ap.payable_account_id) IS DISTINCT FROM (purchase_journal,payable)
  THEN RAISE EXCEPTION 'ACCOUNTING_TEMPLATE_MAPPING_CONFLICT' USING ERRCODE='P0001'; END IF;
 ELSE
  INSERT INTO finance_payable_mappings(company_id,entity_id,journal_id,payable_account_id,updated_by)
  VALUES(p_company,p_entity,purchase_journal,payable,who);changed:=true;
 END IF;
 IF changed OR n_accounts>0 OR n_journals>0 THEN
  INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
  VALUES(p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
   (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),
   'finance.template_initialized',jsonb_build_object('entity_id',p_entity,'treasury',p_treasury,
    'created_accounts',n_accounts,'created_journals',n_journals,'opening_balances_created',false));
 END IF;
 RETURN jsonb_build_object('created_accounts',n_accounts,'created_journals',n_journals,'treasury',p_treasury,
  'already_configured',NOT changed AND n_accounts=0 AND n_journals=0);
END $template$;
REVOKE ALL ON FUNCTION bunyra_initialize_accounting(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_initialize_accounting(uuid,uuid,text,text) TO bunyra_tenant;

CREATE FUNCTION bunyra_initialize_accounting(p_company uuid,p_entity uuid,p_language text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; advances uuid;
BEGIN
 PERFORM bunyra_require_finance_approver(p_company);
 result:=bunyra_initialize_accounting(p_company,p_entity,p_language,'per_transaction');
 SELECT id INTO advances FROM ledger_accounts WHERE company_id=p_company AND entity_id=p_entity AND code='2110';
 INSERT INTO finance_receipt_controls(company_id,entity_id,advance_account_id)
 VALUES(p_company,p_entity,advances) ON CONFLICT(company_id,entity_id) DO NOTHING;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION bunyra_initialize_accounting(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_initialize_accounting(uuid,uuid,text) TO bunyra_tenant;
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
    OR round(native_amount::numeric*rate)<>ev.amount_minor
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
REVOKE ALL ON FUNCTION bunyra_post_finance_event(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_post_finance_event(uuid,uuid) TO bunyra_tenant;

CREATE OR REPLACE FUNCTION bunyra_configure_finance_automation(p_company uuid,p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $configure$
DECLARE who text; BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_INVALID' USING ERRCODE='P0001'; END IF;
 IF p_enabled AND NOT EXISTS(SELECT 1 FROM finance_account_mappings m JOIN ledger_entities e
  ON e.company_id=m.company_id AND e.id=m.entity_id AND e.is_default AND e.active WHERE m.company_id=p_company)
 AND NOT EXISTS(SELECT 1 FROM finance_receipt_controls m JOIN ledger_entities e ON e.company_id=m.company_id
 AND e.id=m.entity_id AND e.is_default AND e.active WHERE m.company_id=p_company)
 THEN RAISE EXCEPTION 'FINANCE_MAPPING_REQUIRED' USING ERRCODE='P0001'; END IF;
 INSERT INTO finance_automation_settings(company_id,enabled,authorized_by)
 VALUES(p_company,p_enabled,who) ON CONFLICT(company_id) DO UPDATE
 SET enabled=EXCLUDED.enabled,authorized_by=EXCLUDED.authorized_by,updated_at=now();
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),'finance.automation_configured',
  jsonb_build_object('enabled',p_enabled,'scope','cash_and_customer_advances_only'));
 RETURN p_enabled;
END $configure$;

CREATE OR REPLACE FUNCTION bunyra_bank_match(p_company uuid,p_bank_line uuid,p_ledger_line uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row_data record; previous treasury_bank_matches%ROWTYPE; matching_account ledger_accounts%ROWTYPE;
       who text; posted text; line ledger_lines%ROWTYPE; result uuid;
BEGIN
 IF p_company IS DISTINCT FROM public.bunyra_tenant_company() THEN
  RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
 AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who
    AND active AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT bl.*,s.bank_account_id,s.status,s.date_from,s.date_to INTO row_data
  FROM treasury_bank_lines bl JOIN treasury_bank_statements s
   ON s.company_id=bl.company_id AND s.entity_id=bl.entity_id AND s.id=bl.statement_id
  WHERE bl.company_id=p_company AND bl.id=p_bank_line FOR UPDATE OF bl FOR SHARE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'TREASURY_LINE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF row_data.status<>'open' THEN RAISE EXCEPTION 'TREASURY_STATEMENT_CLOSED' USING ERRCODE='P0001'; END IF;
 SELECT * INTO previous FROM treasury_bank_matches
  WHERE company_id=p_company AND entity_id=row_data.entity_id AND bank_line_id=p_bank_line;
 IF FOUND THEN
  IF previous.ledger_line_id<>p_ledger_line THEN RAISE EXCEPTION 'TREASURY_ALREADY_MATCHED' USING ERRCODE='P0001'; END IF;
  RETURN previous.id;
 END IF;
 SELECT * INTO line FROM ledger_lines WHERE company_id=p_company
  AND entity_id=row_data.entity_id AND id=p_ledger_line;
 IF NOT FOUND OR line.account_id<>row_data.bank_account_id
  OR COALESCE(line.amount_currency_minor::numeric,line.debit_minor::numeric-line.credit_minor::numeric)<>row_data.signed_minor::numeric
 THEN RAISE EXCEPTION 'TREASURY_AMOUNT_MISMATCH' USING ERRCODE='P0001'; END IF;
 SELECT e.state INTO posted FROM ledger_entries e
  WHERE e.company_id=line.company_id AND e.entity_id=line.entity_id AND e.id=line.entry_id;
 IF posted<>'posted' THEN RAISE EXCEPTION 'TREASURY_NOT_POSTED' USING ERRCODE='P0001'; END IF;
 INSERT INTO treasury_bank_matches(company_id,entity_id,bank_line_id,ledger_line_id,matched_by)
 VALUES(p_company,row_data.entity_id,p_bank_line,p_ledger_line,who) RETURNING id INTO result;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(
  p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),
  'treasury.bank_reconciled',jsonb_build_object('bank_line_id',p_bank_line,'ledger_line_id',p_ledger_line));
 RETURN result;
END $$;

-- Foreign bank lines must always carry their native amount and historical rate.
CREATE FUNCTION bunyra_payment_ledger_line_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE currency text;
BEGIN
 SELECT currency_code INTO currency FROM company_payment_accounts
 WHERE company_id=NEW.company_id AND entity_id=NEW.entity_id AND account_id=NEW.account_id;
 IF FOUND AND (NEW.currency_code<>currency OR (currency<>'EGP' AND NEW.amount_currency_minor IS NULL))
 THEN RAISE EXCEPTION 'PAYMENT_CURRENCY_SNAPSHOT_REQUIRED' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_payment_ledger_line_guard() FROM PUBLIC;
CREATE TRIGGER payment_ledger_line_guard BEFORE INSERT OR UPDATE ON ledger_lines
 FOR EACH ROW EXECUTE FUNCTION bunyra_payment_ledger_line_guard();
INSERT INTO schema_migrations(version) VALUES('057-per-receipt-posting');
COMMIT;
