-- Settlements of posted supplier bills: partial, idempotent, GL-backed, immutable.
-- Not deployed automatically. Apply on isolated Neon branch before production.
BEGIN;
CREATE TABLE finance_vendor_payments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 bill_id uuid NOT NULL,
 journal_id uuid NOT NULL,
 cash_account_id uuid NOT NULL,
 paid_on date NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 100),
 posted_entry_id uuid NOT NULL,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,bill_id,idempotency_key),
 UNIQUE(company_id,entity_id,posted_entry_id),
 FOREIGN KEY(company_id,entity_id,bill_id) REFERENCES finance_vendor_bills(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,journal_id) REFERENCES ledger_journals(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,cash_account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,posted_entry_id) REFERENCES ledger_entries(company_id,entity_id,id)
);
CREATE INDEX finance_vendor_payment_bill ON finance_vendor_payments(company_id,entity_id,bill_id,created_at);
CREATE FUNCTION bunyra_vendor_payment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $paymentguard$
BEGIN
 RAISE EXCEPTION 'VENDOR_PAYMENT_IMMUTABLE' USING ERRCODE='P0001';
END $paymentguard$;
CREATE TRIGGER finance_vendor_payment_immutable
 BEFORE UPDATE OR DELETE ON finance_vendor_payments
 FOR EACH ROW EXECUTE FUNCTION bunyra_vendor_payment_guard();
CREATE FUNCTION bunyra_pay_vendor_bill(
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
  RETURN previous.id;
 END IF;
 IF p_paid_on<bill.invoice_date THEN RAISE EXCEPTION 'VENDOR_PAYMENT_BEFORE_INVOICE' USING ERRCODE='P0001';END IF;
 SELECT COALESCE(sum(amount_minor::numeric),0) INTO paid_total FROM finance_vendor_payments
 WHERE company_id=p_company AND entity_id=bill.entity_id AND bill_id=p_bill;
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
 INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,description,debit_minor,credit_minor)
 VALUES(p_company,bill.entity_id,entry_id,1,map.payable_account_id,'Settle supplier payable',p_amount,0),
       (p_company,bill.entity_id,entry_id,2,p_cash_account,'Supplier payment from cash/bank',0,p_amount);
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
ALTER TABLE finance_vendor_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_vendor_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON finance_vendor_payments TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()))
 WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT ON finance_vendor_payments TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('047-supplier-payments');
COMMIT;
