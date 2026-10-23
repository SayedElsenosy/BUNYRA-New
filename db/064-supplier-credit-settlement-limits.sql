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
  IF EXISTS(SELECT 1 FROM finance_vendor_payment_reversals r WHERE r.company_id=p_company AND r.payment_id=previous.id)
  THEN RAISE EXCEPTION 'VENDOR_PAYMENT_REVERSED' USING ERRCODE='P0001'; END IF;
  RETURN previous.id;
 END IF;
 IF p_paid_on<bill.invoice_date THEN RAISE EXCEPTION 'VENDOR_PAYMENT_BEFORE_INVOICE' USING ERRCODE='P0001';END IF;
 SELECT b.paid_minor,b.remaining_minor INTO paid_total,remaining FROM finance_vendor_bill_balances b
 WHERE b.company_id=p_company AND b.entity_id=bill.entity_id AND b.bill_id=bill.id;
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
CREATE OR REPLACE FUNCTION bunyra_reverse_vendor_payment(p_company uuid,p_payment uuid,p_date date,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who text; payment finance_vendor_payments%ROWTYPE; previous finance_vendor_payment_reversals%ROWTYPE;
 entry uuid; reversal uuid; stamp text; bill uuid;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_date IS NULL OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
 THEN RAISE EXCEPTION 'VENDOR_REVERSAL_INVALID' USING ERRCODE='P0001'; END IF;
 SELECT bill_id INTO bill FROM finance_vendor_payments WHERE company_id=p_company AND id=p_payment;
 IF NOT FOUND THEN RAISE EXCEPTION 'VENDOR_PAYMENT_NOT_FOUND' USING ERRCODE='P0001'; END IF;
 -- Same lock order as bill settlement, serializing available amount and corrections.
 PERFORM id FROM finance_vendor_bills WHERE company_id=p_company AND id=bill FOR UPDATE;
 SELECT * INTO payment FROM finance_vendor_payments WHERE company_id=p_company AND id=p_payment FOR SHARE;
 SELECT * INTO previous FROM finance_vendor_payment_reversals
 WHERE company_id=p_company AND entity_id=payment.entity_id AND payment_id=p_payment;
 IF FOUND THEN
  IF previous.reversed_on<>p_date OR previous.reason<>trim(p_reason)
  THEN RAISE EXCEPTION 'VENDOR_REVERSAL_CONFLICT' USING ERRCODE='P0001'; END IF;
  RETURN previous.id;
 END IF;
 IF p_date<payment.paid_on THEN RAISE EXCEPTION 'VENDOR_REVERSAL_BEFORE_PAYMENT' USING ERRCODE='P0001'; END IF;
 IF (SELECT b.paid_minor FROM finance_vendor_bill_balances b WHERE b.company_id=p_company AND b.entity_id=payment.entity_id AND b.bill_id=payment.bill_id)<payment.amount_minor
 THEN RAISE EXCEPTION 'VENDOR_PAYMENT_REFUND_CONFLICT' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vendor-payment-entry:'||payment.posted_entry_id::text,0));
 IF EXISTS(SELECT 1 FROM treasury_bank_matches m JOIN ledger_lines l
  ON l.company_id=m.company_id AND l.entity_id=m.entity_id AND l.id=m.ledger_line_id
  WHERE l.company_id=p_company AND l.entry_id=payment.posted_entry_id)
 THEN RAISE EXCEPTION 'VENDOR_PAYMENT_RECONCILED' USING ERRCODE='P0001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_entries WHERE company_id=p_company AND entity_id=payment.entity_id
  AND id=payment.posted_entry_id AND state='posted')
 THEN RAISE EXCEPTION 'VENDOR_PAYMENT_NOT_POSTED' USING ERRCODE='P0001'; END IF;
 entry:=gen_random_uuid();reversal:=gen_random_uuid();
 stamp:=encode(sha256(convert_to(payment.id::text||p_date::text||trim(p_reason),'UTF8')),'hex');
 INSERT INTO ledger_entries(id,company_id,entity_id,journal_id,entry_date,reference,description,
  source_type,source_id,source_event,idempotency_key,payload_hash,created_by)
 SELECT entry,p_company,payment.entity_id,payment.journal_id,p_date,left('AP-REV:'||reference,200),trim(p_reason),
  'vendor_bill',payment.bill_id,'payment_reversed_'||payment.id::text,'vendorpay-reverse:'||payment.id::text,stamp,who
 FROM ledger_entries WHERE company_id=p_company AND entity_id=payment.entity_id AND id=payment.posted_entry_id;
 INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,project_id,cost_center_id,
  customer_id,contract_id,vendor_id,description,debit_minor,credit_minor,currency_code,amount_currency_minor,exchange_rate)
 SELECT company_id,entity_id,entry,line_number,account_id,project_id,cost_center_id,
  customer_id,contract_id,vendor_id,left('Supplier payment correction: '||description,500),credit_minor,debit_minor,
  currency_code,-amount_currency_minor,exchange_rate
 FROM ledger_lines WHERE company_id=p_company AND entity_id=payment.entity_id AND entry_id=payment.posted_entry_id;
 PERFORM bunyra_ledger_post_entry(p_company,entry);
 INSERT INTO finance_vendor_payment_reversals(id,company_id,entity_id,payment_id,posted_entry_id,reversed_on,reason,created_by)
 VALUES(reversal,p_company,payment.entity_id,payment.id,entry,p_date,trim(p_reason),who);
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),'finance.vendor_payment_reversed',
  jsonb_build_object('payment_id',payment.id,'reversal_id',reversal,'entry_id',entry,'bill_id',payment.bill_id,
   'amount_minor',payment.amount_minor,'reversed_on',p_date,'reason',trim(p_reason)));
 RETURN reversal;
END $$;
REVOKE ALL ON FUNCTION bunyra_reverse_vendor_payment(uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_reverse_vendor_payment(uuid,uuid,date,text) TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('064-supplier-credit-settlement-limits');
COMMIT;
