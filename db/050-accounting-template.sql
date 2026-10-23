-- Opt-in base chart and mappings. No opening balances, taxes or revenue recognition.
BEGIN;
CREATE FUNCTION bunyra_require_finance_approver(p_company uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $authority$
DECLARE who text:=current_setting('app.user_id',true);
BEGIN
 IF p_company IS DISTINCT FROM bunyra_tenant_company()
  OR NOT EXISTS(SELECT 1 FROM companies WHERE id=p_company AND status='active')
  OR (NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
   AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who
    AND active AND role IN('company_admin','finance_manager')))
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN who;
END $authority$;
REVOKE ALL ON FUNCTION bunyra_require_finance_approver(uuid) FROM PUBLIC;

CREATE FUNCTION bunyra_initialize_accounting(p_company uuid,p_entity uuid,p_language text,p_treasury text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $template$
DECLARE who text; item record; existing record; n_accounts integer:=0; n_journals integer:=0;
 treasury_account uuid; advances uuid; payable uuid; treasury_journal uuid; purchase_journal uuid;
 existing_mapping finance_account_mappings%ROWTYPE; existing_ap finance_payable_mappings%ROWTYPE;
 changed boolean:=false;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_language IS NULL OR p_language NOT IN('ar','en') OR p_treasury IS NULL OR p_treasury NOT IN('cash','bank')
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
 SELECT * INTO existing_mapping FROM finance_account_mappings WHERE company_id=p_company AND entity_id=p_entity FOR UPDATE;
 IF FOUND THEN
  IF (existing_mapping.journal_id,existing_mapping.cash_account_id,existing_mapping.advance_account_id)
   IS DISTINCT FROM (treasury_journal,treasury_account,advances)
  THEN RAISE EXCEPTION 'ACCOUNTING_TEMPLATE_MAPPING_CONFLICT' USING ERRCODE='P0001'; END IF;
 ELSE
  INSERT INTO finance_account_mappings(company_id,entity_id,journal_id,cash_account_id,advance_account_id,updated_by)
  VALUES(p_company,p_entity,treasury_journal,treasury_account,advances,who);changed:=true;
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
INSERT INTO schema_migrations(version) VALUES('050-accounting-template');
COMMIT;
