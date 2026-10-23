-- Correct an erroneous supplier payment through an immutable counter-entry.
BEGIN;
CREATE TABLE finance_vendor_payment_reversals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,entity_id uuid NOT NULL,
 payment_id uuid NOT NULL,posted_entry_id uuid NOT NULL,reversed_on date NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,payment_id),UNIQUE(company_id,entity_id,posted_entry_id),
 FOREIGN KEY(company_id,entity_id,payment_id) REFERENCES finance_vendor_payments(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,posted_entry_id) REFERENCES ledger_entries(company_id,entity_id,id)
);
ALTER TABLE finance_vendor_payment_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_vendor_payment_reversals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON finance_vendor_payment_reversals TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT ON finance_vendor_payment_reversals TO bunyra_tenant;
CREATE TRIGGER vendor_payment_reversal_immutable BEFORE UPDATE OR DELETE ON finance_vendor_payment_reversals
 FOR EACH ROW EXECUTE FUNCTION bunyra_vendor_payment_guard();

CREATE FUNCTION bunyra_reverse_vendor_payment(p_company uuid,p_payment uuid,p_date date,p_reason text)
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
INSERT INTO schema_migrations(version) VALUES('060-supplier-payment-reversals');
COMMIT;
