BEGIN;
CREATE OR REPLACE FUNCTION bunyra_pay_vendor_bill(
 p_company uuid,p_bill uuid,p_journal uuid,p_cash_account uuid,p_paid_on date,
 p_amount bigint,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $vendorpay$
DECLARE bill finance_vendor_bills%ROWTYPE; map finance_payable_mappings%ROWTYPE;
 previous finance_vendor_payments%ROWTYPE; who text; paid_total numeric; remaining numeric;
 entry_id uuid; payment_id uuid; hash_value text; entry_key text; event_key text;
BEGIN
 IF p_company IS DISTINCT FROM bunyra_tenant_company()
 THEN RAISE EXCEPTION 'VENDOR_PAYMENT_FORBIDDEN' USING ERRCODE='42501';END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
  AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who
   AND active AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'VENDOR_PAYMENT_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF p_paid_on IS NULL OR p_amount IS NULL OR p_amount<=0
  OR length(p_key) NOT BETWEEN 8 AND 100
 THEN RAISE EXCEPTION 'VENDOR_PAYMENT_INVALID' USING ERRCODE='P0001';END IF;
 SELECT * INTO bill FROM finance_vendor_bills WHERE company_id=p_company AND id=p_bill FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VENDOR_BILL_NOT_FOUND' USING ERRCODE='P0001';END IF;
 IF bill.status<>'posted' OR bill.posted_entry_id IS NULL
 THEN RAISE EXCEPTION 'VENDOR_PAYMENT_REQUIRES_POSTED_BILL' USING ERRCODE='P0001';END IF;
 SELECT * INTO previous FROM finance_vendor_payments WHERE company_id=p_company AND entity_id=bill.entity_id
  AND bill_id=p_bill AND idempotency_key=p_key FOR SHARE;
 IF FOUND THEN
  IF previous.amount_minor<>p_amount OR previous.paid_on<>p_paid_on
   OR previous.journal_id<>p_journal OR previous.cash_account_id<>p_cash_account
  THEN RAISE EXCEPTION 'VENDOR_PAYMENT_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM finance_vendor_payment_reversals WHERE company_id=p_company AND payment_id=previous.id)
  THEN RAISE EXCEPTION 'VENDOR_PAYMENT_REVERSED' USING ERRCODE='P0001'; END IF;
  RETURN previous.id;
 END IF;
 IF p_paid_on<bill.invoice_date THEN RAISE EXCEPTION 'VENDOR_PAYMENT_BEFORE_INVOICE' USING ERRCODE='P0001';END IF;
 SELECT COALESCE(sum(amount_minor::numeric),0) INTO paid_total FROM finance_vendor_payments
 WHERE company_id=p_company AND entity_id=bill.entity_id AND bill_id=p_bill
 AND NOT EXISTS(SELECT 1 FROM finance_vendor_payment_reversals r WHERE r.company_id=p_company
  AND r.entity_id=bill.entity_id AND r.payment_id=finance_vendor_payments.id);
 remaining:=bill.total_minor::numeric-paid_total;
 IF p_amount::numeric>remaining THEN RAISE EXCEPTION 'VENDOR_PAYMENT_OVERPAID' USING ERRCODE='P0001';END IF;
 SELECT * INTO map FROM finance_payable_mappings WHERE company_id=p_company AND entity_id=bill.entity_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_PAYABLE_MAPPING_REQUIRED' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_accounts x WHERE x.company_id=p_company
  AND x.entity_id=bill.entity_id AND x.id=map.payable_account_id
  AND x.role='payable' AND x.kind='liability' AND x.allow_posting AND x.active)
 OR NOT EXISTS(
  SELECT 1 FROM ledger_accounts a JOIN ledger_journals j
   ON j.company_id=a.company_id AND j.entity_id=a.entity_id AND j.id=p_journal
   AND j.active AND ((a.role='bank' AND j.kind='bank') OR (a.role='cash' AND j.kind='cash'))
  WHERE a.company_id=p_company AND a.entity_id=bill.entity_id AND a.id=p_cash_account
   AND a.role IN('bank','cash') AND a.kind='asset' AND a.allow_posting AND a.active
 ) THEN RAISE EXCEPTION 'VENDOR_PAYMENT_MAPPING_INVALID' USING ERRCODE='P0001';END IF;
 payment_id:=gen_random_uuid();entry_id:=gen_random_uuid();
 entry_key:='vendorpay:'||encode(sha256(convert_to(p_bill::text||':'||p_key,'UTF8')),'hex');
 event_key:='payment_'||encode(sha256(convert_to(p_key,'UTF8')),'hex');
 hash_value:=encode(sha256(convert_to(p_company::text||p_bill::text||p_journal::text||
  p_cash_account::text||p_paid_on::text||p_amount::text||p_key,'UTF8')),'hex');
 INSERT INTO ledger_entries(id,company_id,entity_id,journal_id,entry_date,reference,description,
  source_type,source_id,source_event,idempotency_key,payload_hash,created_by)
 VALUES(entry_id,p_company,bill.entity_id,p_journal,p_paid_on,
  left('AP-PAY:'||bill.invoice_number,200),'Supplier bill payment',
  'vendor_bill',bill.id,event_key,entry_key,hash_value,who);
 INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,vendor_id,description,debit_minor,credit_minor)
 VALUES(p_company,bill.entity_id,entry_id,1,map.payable_account_id,bill.vendor_id,'Settle supplier payable',p_amount,0),
       (p_company,bill.entity_id,entry_id,2,p_cash_account,bill.vendor_id,'Supplier payment from cash/bank',0,p_amount);
 PERFORM bunyra_ledger_post_entry(p_company,entry_id);
 INSERT INTO finance_vendor_payments(id,company_id,entity_id,bill_id,journal_id,cash_account_id,
  paid_on,amount_minor,idempotency_key,posted_entry_id,created_by)
 VALUES(payment_id,p_company,bill.entity_id,bill.id,p_journal,p_cash_account,
  p_paid_on,p_amount,p_key,entry_id,who);
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),'finance.vendor_bill_payment_posted',
  jsonb_build_object('bill_id',bill.id,'payment_id',payment_id,'entry_id',entry_id,
   'amount_minor',p_amount,'remaining_minor',remaining-p_amount));
 RETURN payment_id;
END $vendorpay$;
REVOKE ALL ON FUNCTION bunyra_pay_vendor_bill(uuid,uuid,uuid,uuid,date,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_pay_vendor_bill(uuid,uuid,uuid,uuid,date,bigint,text) TO bunyra_tenant;
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
 PERFORM pg_advisory_xact_lock(hashtextextended('vendor-payment-entry:'||line.entry_id::text,0));
 IF EXISTS(SELECT 1 FROM finance_vendor_payment_reversals r JOIN finance_vendor_payments p
  ON p.company_id=r.company_id AND p.entity_id=r.entity_id AND p.id=r.payment_id
  WHERE r.company_id=p_company AND r.entity_id=line.entity_id
   AND (p.posted_entry_id=line.entry_id OR r.posted_entry_id=line.entry_id))
 THEN RAISE EXCEPTION 'VENDOR_PAYMENT_REVERSED' USING ERRCODE='P0001'; END IF;
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

INSERT INTO schema_migrations(version) VALUES('061-net-supplier-settlements');
COMMIT;
