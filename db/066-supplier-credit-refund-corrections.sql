BEGIN;
ALTER TABLE finance_vendor_credits ADD UNIQUE(company_id,entity_id,id);
ALTER TABLE finance_vendor_refunds ADD UNIQUE(company_id,entity_id,id);
CREATE TABLE finance_vendor_credit_reversals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,entity_id uuid NOT NULL,
 credit_id uuid NOT NULL,posted_entry_id uuid NOT NULL,reversed_on date NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,credit_id),UNIQUE(company_id,entity_id,posted_entry_id),
 FOREIGN KEY(company_id,entity_id,credit_id) REFERENCES finance_vendor_credits(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,posted_entry_id) REFERENCES ledger_entries(company_id,entity_id,id)
);
ALTER TABLE finance_vendor_credit_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_vendor_credit_reversals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON finance_vendor_credit_reversals TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT ON finance_vendor_credit_reversals TO bunyra_tenant;
CREATE TRIGGER supplier_adjustment_immutable BEFORE UPDATE OR DELETE ON finance_vendor_credit_reversals FOR EACH ROW EXECUTE FUNCTION bunyra_supplier_adjustment_immutable();
CREATE TABLE finance_vendor_refund_reversals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,entity_id uuid NOT NULL,
 refund_id uuid NOT NULL,posted_entry_id uuid NOT NULL,reversed_on date NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,refund_id),UNIQUE(company_id,entity_id,posted_entry_id),
 FOREIGN KEY(company_id,entity_id,refund_id) REFERENCES finance_vendor_refunds(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,posted_entry_id) REFERENCES ledger_entries(company_id,entity_id,id)
);
ALTER TABLE finance_vendor_refund_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_vendor_refund_reversals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON finance_vendor_refund_reversals TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT ON finance_vendor_refund_reversals TO bunyra_tenant;
CREATE TRIGGER supplier_adjustment_immutable BEFORE UPDATE OR DELETE ON finance_vendor_refund_reversals FOR EACH ROW EXECUTE FUNCTION bunyra_supplier_adjustment_immutable();
CREATE VIEW finance_active_vendor_credits WITH(security_invoker=true) AS
 SELECT d.* FROM finance_vendor_credits d WHERE NOT EXISTS(SELECT 1 FROM finance_vendor_credit_reversals r WHERE r.company_id=d.company_id AND r.entity_id=d.entity_id AND r.credit_id=d.id);
GRANT SELECT ON finance_active_vendor_credits TO bunyra_tenant;
CREATE VIEW finance_active_vendor_refunds WITH(security_invoker=true) AS
 SELECT d.* FROM finance_vendor_refunds d WHERE NOT EXISTS(SELECT 1 FROM finance_vendor_refund_reversals r WHERE r.company_id=d.company_id AND r.entity_id=d.entity_id AND r.refund_id=d.id);
GRANT SELECT ON finance_active_vendor_refunds TO bunyra_tenant;
CREATE OR REPLACE VIEW finance_vendor_bill_balances WITH(security_invoker=true) AS
 SELECT b.company_id,b.entity_id,b.id AS bill_id,credits.amount AS credited_minor,
  b.total_minor::numeric-credits.amount AS net_total_minor,payments.amount-refunds.amount AS paid_minor,
  greatest(b.total_minor::numeric-credits.amount-payments.amount+refunds.amount,0) AS remaining_minor,
  greatest(payments.amount-refunds.amount-b.total_minor::numeric+credits.amount,0) AS refundable_minor
 FROM finance_vendor_bills b
 CROSS JOIN LATERAL(SELECT coalesce(sum(c.amount_minor::numeric),0) AS amount FROM finance_active_vendor_credits c WHERE c.company_id=b.company_id AND c.entity_id=b.entity_id AND c.bill_id=b.id) credits
 CROSS JOIN LATERAL(SELECT coalesce(sum(p.amount_minor::numeric),0) AS amount FROM finance_vendor_payments p WHERE p.company_id=b.company_id AND p.entity_id=b.entity_id AND p.bill_id=b.id
  AND NOT EXISTS(SELECT 1 FROM finance_vendor_payment_reversals r WHERE r.company_id=p.company_id AND r.entity_id=p.entity_id AND r.payment_id=p.id)) payments
 CROSS JOIN LATERAL(SELECT coalesce(sum(r.amount_minor::numeric),0) AS amount FROM finance_active_vendor_refunds r WHERE r.company_id=b.company_id AND r.entity_id=b.entity_id AND r.bill_id=b.id) refunds;
CREATE OR REPLACE FUNCTION bunyra_post_vendor_credit(p_company uuid,p_bill uuid,p_reference text,p_date date,p_reason text,p_key text,p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who text; bill finance_vendor_bills%ROWTYPE; previous finance_vendor_credits%ROWTYPE;
 credit uuid:=gen_random_uuid(); entry uuid:=gen_random_uuid(); payable uuid; journal uuid;
 normalized jsonb; amount numeric; valid_count integer; stamp text;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_reference IS NULL OR length(trim(p_reference)) NOT BETWEEN 2 AND 100 OR p_reason IS NULL
  OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 OR p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 100
  OR p_date IS NULL OR p_lines IS NULL OR jsonb_typeof(p_lines)<>'array'
 THEN RAISE EXCEPTION 'VENDOR_CREDIT_INVALID' USING ERRCODE='P0001'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'VENDOR_CREDIT_INVALID' USING ERRCODE='P0001'; END IF;
 SELECT * INTO bill FROM finance_vendor_bills WHERE company_id=p_company AND id=p_bill FOR UPDATE;
 IF NOT FOUND OR bill.status<>'posted' THEN RAISE EXCEPTION 'VENDOR_CREDIT_REQUIRES_POSTED_BILL' USING ERRCODE='P0001'; END IF;
 IF p_date<bill.invoice_date THEN RAISE EXCEPTION 'VENDOR_CREDIT_BEFORE_BILL' USING ERRCODE='P0001'; END IF;
 SELECT count(DISTINCT x.bill_line_id),sum(x.amount_minor::numeric),
  jsonb_agg(jsonb_build_object('bill_line_id',x.bill_line_id,'amount_minor',x.amount_minor::text) ORDER BY x.bill_line_id)
 INTO valid_count,amount,normalized
 FROM jsonb_to_recordset(p_lines) AS x(bill_line_id uuid,amount_minor bigint)
 JOIN finance_vendor_bill_lines l ON l.company_id=p_company AND l.entity_id=bill.entity_id AND l.bill_id=bill.id AND l.id=x.bill_line_id
 WHERE x.amount_minor>0;
 IF valid_count<>jsonb_array_length(p_lines) OR amount IS NULL OR amount>bill.total_minor
 THEN RAISE EXCEPTION 'VENDOR_CREDIT_LINES_INVALID' USING ERRCODE='P0001'; END IF;
 stamp:=encode(sha256(convert_to(jsonb_build_object('bill',p_bill,'reference',trim(p_reference),'date',p_date,'reason',trim(p_reason),'lines',normalized)::text,'UTF8')),'hex');
 SELECT * INTO previous FROM finance_vendor_credits WHERE company_id=p_company AND entity_id=bill.entity_id AND bill_id=p_bill AND idempotency_key=p_key;
 IF FOUND THEN
  IF previous.payload_hash<>stamp THEN RAISE EXCEPTION 'VENDOR_CREDIT_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF EXISTS(SELECT 1 FROM finance_vendor_credit_reversals WHERE company_id=p_company AND entity_id=bill.entity_id AND credit_id=previous.id) THEN RAISE EXCEPTION 'VENDOR_CREDIT_REVERSED' USING ERRCODE='P0001'; END IF;
  RETURN previous.id;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(normalized) AS x(bill_line_id uuid,amount_minor bigint)
  JOIN finance_vendor_bill_lines l ON l.company_id=p_company AND l.entity_id=bill.entity_id AND l.bill_id=bill.id AND l.id=x.bill_line_id
  WHERE x.amount_minor::numeric+coalesce((SELECT sum(c.amount_minor::numeric) FROM finance_vendor_credit_lines c
   WHERE c.company_id=p_company AND c.entity_id=bill.entity_id AND c.bill_line_id=l.id AND NOT EXISTS(SELECT 1 FROM finance_vendor_credit_reversals r WHERE r.company_id=c.company_id AND r.entity_id=c.entity_id AND r.credit_id=c.credit_id)),0)>l.amount_minor)
 THEN RAISE EXCEPTION 'VENDOR_CREDIT_EXCEEDS_LINE' USING ERRCODE='P0001'; END IF;
 SELECT e.journal_id INTO journal FROM ledger_entries e WHERE e.company_id=p_company AND e.entity_id=bill.entity_id AND e.id=bill.posted_entry_id AND e.state='posted';
 SELECT l.account_id INTO payable FROM ledger_lines l JOIN ledger_accounts a ON a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
 WHERE l.company_id=p_company AND l.entity_id=bill.entity_id AND l.entry_id=bill.posted_entry_id AND a.role='payable' AND l.credit_minor>0 GROUP BY l.account_id HAVING sum(l.credit_minor::numeric)=bill.total_minor;
 IF payable IS NULL OR journal IS NULL THEN RAISE EXCEPTION 'FINANCE_PAYABLE_MAPPING_INVALID' USING ERRCODE='P0001'; END IF;
 INSERT INTO ledger_entries(id,company_id,entity_id,journal_id,entry_date,reference,description,source_type,source_id,source_event,idempotency_key,payload_hash,created_by)
 VALUES(entry,p_company,bill.entity_id,journal,p_date,left('AP-CREDIT:'||trim(p_reference),200),trim(p_reason),'vendor_bill',bill.id,'credit_'||credit::text,'vendorcredit:'||credit::text,stamp,who);
 INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,project_id,cost_center_id,vendor_id,description,debit_minor,credit_minor)
 SELECT p_company,bill.entity_id,entry,row_number() OVER(ORDER BY l.line_number)*2-1,payable,l.project_id,l.cost_center_id,bill.vendor_id,trim(p_reason),x.amount_minor,0
 FROM jsonb_to_recordset(normalized) AS x(bill_line_id uuid,amount_minor bigint)
 JOIN finance_vendor_bill_lines l ON l.company_id=p_company AND l.entity_id=bill.entity_id AND l.bill_id=bill.id AND l.id=x.bill_line_id
 UNION ALL
 SELECT p_company,bill.entity_id,entry,row_number() OVER(ORDER BY l.line_number)*2,l.expense_account_id,l.project_id,l.cost_center_id,bill.vendor_id,l.description,0,x.amount_minor
 FROM jsonb_to_recordset(normalized) AS x(bill_line_id uuid,amount_minor bigint)
 JOIN finance_vendor_bill_lines l ON l.company_id=p_company AND l.entity_id=bill.entity_id AND l.bill_id=bill.id AND l.id=x.bill_line_id;
 PERFORM bunyra_ledger_post_entry(p_company,entry);
 INSERT INTO finance_vendor_credits(id,company_id,entity_id,bill_id,reference,credit_date,reason,amount_minor,posted_entry_id,idempotency_key,payload_hash,created_by)
 VALUES(credit,p_company,bill.entity_id,bill.id,trim(p_reference),p_date,trim(p_reason),amount::bigint,entry,p_key,stamp,who);
 INSERT INTO finance_vendor_credit_lines(company_id,entity_id,bill_id,credit_id,bill_line_id,amount_minor)
 SELECT p_company,bill.entity_id,bill.id,credit,x.bill_line_id,x.amount_minor FROM jsonb_to_recordset(normalized) AS x(bill_line_id uuid,amount_minor bigint);
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,'','finance.vendor_credit_posted',jsonb_build_object('credit_id',credit,'bill_id',bill.id,'entry_id',entry,'amount_minor',amount,'reference',trim(p_reference),'reason',trim(p_reason)));
 RETURN credit;
END $$;
REVOKE ALL ON FUNCTION bunyra_post_vendor_credit(uuid,uuid,text,date,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_post_vendor_credit(uuid,uuid,text,date,text,text,jsonb) TO bunyra_tenant;

CREATE OR REPLACE FUNCTION bunyra_receive_vendor_refund(p_company uuid,p_credit uuid,p_account uuid,p_date date,p_amount bigint,p_reference text,p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who text; credit finance_vendor_credits%ROWTYPE; previous finance_vendor_refunds%ROWTYPE;
 account company_payment_accounts%ROWTYPE; refundable numeric; refunded numeric; bill uuid; payable uuid;
 entry uuid:=gen_random_uuid(); refund uuid:=gen_random_uuid(); stamp text;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_date IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_reference IS NULL OR length(trim(p_reference)) NOT BETWEEN 2 AND 120
 OR p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 100 THEN RAISE EXCEPTION 'VENDOR_REFUND_INVALID' USING ERRCODE='P0001'; END IF;
 SELECT bill_id INTO bill FROM finance_vendor_credits WHERE company_id=p_company AND id=p_credit;
 IF NOT FOUND THEN RAISE EXCEPTION 'VENDOR_CREDIT_NOT_FOUND' USING ERRCODE='P0001'; END IF;
 PERFORM id FROM finance_vendor_bills WHERE company_id=p_company AND id=bill FOR UPDATE;
 SELECT * INTO credit FROM finance_vendor_credits WHERE company_id=p_company AND id=p_credit;
 stamp:=encode(sha256(convert_to(jsonb_build_object('credit',p_credit,'account',p_account,'date',p_date,'amount',p_amount::text,'reference',trim(p_reference))::text,'UTF8')),'hex');
 SELECT * INTO previous FROM finance_vendor_refunds r WHERE r.company_id=p_company AND r.entity_id=credit.entity_id AND r.credit_id=p_credit AND r.idempotency_key=p_key;
 IF FOUND THEN
  IF previous.payload_hash<>stamp THEN RAISE EXCEPTION 'VENDOR_REFUND_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF EXISTS(SELECT 1 FROM finance_vendor_refund_reversals WHERE company_id=p_company AND entity_id=credit.entity_id AND refund_id=previous.id) THEN RAISE EXCEPTION 'VENDOR_REFUND_REVERSED' USING ERRCODE='P0001'; END IF;
  RETURN previous.id;
 END IF;
 IF EXISTS(SELECT 1 FROM finance_vendor_credit_reversals WHERE company_id=p_company AND entity_id=credit.entity_id AND credit_id=p_credit) THEN RAISE EXCEPTION 'VENDOR_CREDIT_REVERSED' USING ERRCODE='P0001'; END IF;
 IF p_date<credit.credit_date THEN RAISE EXCEPTION 'VENDOR_REFUND_BEFORE_CREDIT' USING ERRCODE='P0001'; END IF;
 SELECT b.refundable_minor INTO refundable FROM finance_vendor_bill_balances b WHERE b.company_id=p_company AND b.bill_id=credit.bill_id;
 -- A backdated receipt may not borrow refund capacity from later-dated payments or credits.
 SELECT least(refundable,greatest(
  coalesce((SELECT sum(p.amount_minor::numeric) FROM finance_vendor_payments p
    WHERE p.company_id=p_company AND p.entity_id=credit.entity_id AND p.bill_id=credit.bill_id AND p.paid_on<=p_date
     AND NOT EXISTS(SELECT 1 FROM finance_vendor_payment_reversals x WHERE x.company_id=p.company_id AND x.entity_id=p.entity_id AND x.payment_id=p.id)),0)
  -coalesce((SELECT sum(r.amount_minor::numeric) FROM finance_vendor_refunds r WHERE r.company_id=p_company AND r.entity_id=credit.entity_id AND r.bill_id=credit.bill_id
    AND NOT EXISTS(SELECT 1 FROM finance_vendor_refund_reversals x WHERE x.company_id=r.company_id AND x.entity_id=r.entity_id AND x.refund_id=r.id AND x.reversed_on<=p_date)),0)
  -(SELECT b.total_minor FROM finance_vendor_bills b WHERE b.company_id=p_company AND b.id=credit.bill_id)
  +coalesce((SELECT sum(c.amount_minor::numeric) FROM finance_active_vendor_credits c WHERE c.company_id=p_company AND c.entity_id=credit.entity_id AND c.bill_id=credit.bill_id AND c.credit_date<=p_date),0),0)) INTO refundable;
 SELECT coalesce(sum(r.amount_minor::numeric),0) INTO refunded FROM finance_active_vendor_refunds r WHERE r.company_id=p_company AND r.entity_id=credit.entity_id AND r.credit_id=p_credit;
 IF p_amount::numeric>refundable OR p_amount::numeric+refunded>credit.amount_minor
 THEN RAISE EXCEPTION 'VENDOR_REFUND_EXCEEDS_CREDIT' USING ERRCODE='P0001'; END IF;
 SELECT * INTO account FROM company_payment_accounts a WHERE a.company_id=p_company AND a.entity_id=credit.entity_id AND a.id=p_account AND a.active AND a.currency_code='EGP' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VENDOR_REFUND_ACCOUNT_INVALID' USING ERRCODE='P0001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_accounts a JOIN ledger_journals j ON j.company_id=a.company_id AND j.entity_id=a.entity_id AND j.id=account.journal_id
  WHERE a.company_id=p_company AND a.entity_id=credit.entity_id AND a.id=account.account_id AND a.active AND a.allow_posting AND a.kind='asset'
   AND a.role=account.kind AND j.active AND j.kind=account.kind)
 THEN RAISE EXCEPTION 'VENDOR_REFUND_ACCOUNT_INVALID' USING ERRCODE='P0001'; END IF;
 SELECT l.account_id INTO payable FROM ledger_lines l JOIN ledger_accounts a ON a.company_id=l.company_id AND a.entity_id=l.entity_id AND a.id=l.account_id
 WHERE l.company_id=p_company AND l.entity_id=credit.entity_id AND l.entry_id=credit.posted_entry_id AND a.role='payable' AND l.debit_minor>0 GROUP BY l.account_id HAVING sum(l.debit_minor::numeric)=credit.amount_minor;
 IF payable IS NULL THEN RAISE EXCEPTION 'FINANCE_PAYABLE_MAPPING_INVALID' USING ERRCODE='P0001'; END IF;
 INSERT INTO ledger_entries(id,company_id,entity_id,journal_id,entry_date,reference,description,source_type,source_id,source_event,idempotency_key,payload_hash,created_by)
 VALUES(entry,p_company,credit.entity_id,account.journal_id,p_date,left('AP-REFUND:'||trim(p_reference),200),'Received supplier refund','vendor_bill',credit.bill_id,'refund_'||refund::text,'vendorrefund:'||refund::text,stamp,who);
 INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,vendor_id,description,debit_minor,credit_minor,currency_code,amount_currency_minor,exchange_rate)
 VALUES(p_company,credit.entity_id,entry,1,account.account_id,(SELECT vendor_id FROM finance_vendor_bills WHERE company_id=p_company AND id=credit.bill_id),'Received supplier refund',p_amount,0,'EGP',p_amount,1),
       (p_company,credit.entity_id,entry,2,payable,(SELECT vendor_id FROM finance_vendor_bills WHERE company_id=p_company AND id=credit.bill_id),'Clear supplier refund receivable',0,p_amount,'EGP',-p_amount,1);
 PERFORM bunyra_ledger_post_entry(p_company,entry);
 INSERT INTO finance_vendor_refunds(id,company_id,entity_id,bill_id,credit_id,payment_account_id,received_on,reference,amount_minor,posted_entry_id,idempotency_key,payload_hash,created_by)
 VALUES(refund,p_company,credit.entity_id,credit.bill_id,credit.id,account.id,p_date,trim(p_reference),p_amount,entry,p_key,stamp,who);
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,'','finance.vendor_refund_received',jsonb_build_object('refund_id',refund,'credit_id',credit.id,'bill_id',credit.bill_id,'entry_id',entry,'amount_minor',p_amount,'payment_account_id',account.id));
 RETURN refund;
END $$;
REVOKE ALL ON FUNCTION bunyra_receive_vendor_refund(uuid,uuid,uuid,date,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_receive_vendor_refund(uuid,uuid,uuid,date,bigint,text,text) TO bunyra_tenant;
CREATE FUNCTION bunyra_reverse_vendor_credit(p_company uuid,p_credit uuid,p_date date,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who text; document finance_vendor_credits%ROWTYPE; previous finance_vendor_credit_reversals%ROWTYPE;
 bill uuid; entry uuid:=gen_random_uuid(); reversal uuid:=gen_random_uuid(); stamp text;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_date IS NULL OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'VENDOR_REVERSAL_INVALID' USING ERRCODE='P0001'; END IF;
 SELECT bill_id INTO bill FROM finance_vendor_credits WHERE company_id=p_company AND id=p_credit;
 IF NOT FOUND THEN RAISE EXCEPTION 'VENDOR_CREDIT_NOT_FOUND' USING ERRCODE='P0001'; END IF;
 -- All settlement, credit, receipt and correction operations serialize on the bill first.
 PERFORM id FROM finance_vendor_bills WHERE company_id=p_company AND id=bill FOR UPDATE;
 SELECT * INTO document FROM finance_vendor_credits WHERE company_id=p_company AND id=p_credit;
 SELECT * INTO previous FROM finance_vendor_credit_reversals WHERE company_id=p_company AND entity_id=document.entity_id AND credit_id=p_credit;
 IF FOUND THEN
  IF previous.reversed_on<>p_date OR previous.reason<>trim(p_reason) THEN RAISE EXCEPTION 'VENDOR_REVERSAL_CONFLICT' USING ERRCODE='P0001'; END IF;
  RETURN previous.id;
 END IF;
 IF p_date<document.credit_date THEN RAISE EXCEPTION 'VENDOR_CREDIT_REVERSAL_BEFORE_SOURCE' USING ERRCODE='P0001'; END IF;
 IF EXISTS(SELECT 1 FROM finance_vendor_refunds r LEFT JOIN finance_vendor_refund_reversals x ON x.company_id=r.company_id AND x.entity_id=r.entity_id AND x.refund_id=r.id
  WHERE r.company_id=p_company AND r.entity_id=document.entity_id AND r.credit_id=document.id AND (x.id IS NULL OR x.reversed_on>p_date))
 THEN RAISE EXCEPTION 'VENDOR_CREDIT_REFUND_CONFLICT' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vendor-payment-entry:'||document.posted_entry_id::text,0));
 IF EXISTS(SELECT 1 FROM treasury_bank_matches m JOIN ledger_lines l ON l.company_id=m.company_id AND l.entity_id=m.entity_id AND l.id=m.ledger_line_id
  WHERE l.company_id=p_company AND l.entity_id=document.entity_id AND l.entry_id=document.posted_entry_id)
 THEN RAISE EXCEPTION 'VENDOR_CREDIT_RECONCILED' USING ERRCODE='P0001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_entries WHERE company_id=p_company AND entity_id=document.entity_id AND id=document.posted_entry_id AND state='posted') THEN RAISE EXCEPTION 'VENDOR_CREDIT_NOT_POSTED' USING ERRCODE='P0001'; END IF;
 stamp:=encode(sha256(convert_to(document.id::text||p_date::text||trim(p_reason),'UTF8')),'hex');
 INSERT INTO ledger_entries(id,company_id,entity_id,journal_id,entry_date,reference,description,source_type,source_id,source_event,idempotency_key,payload_hash,created_by)
 SELECT entry,p_company,document.entity_id,journal_id,p_date,left('AP-CREDIT-REV:'||reference,200),trim(p_reason),'vendor_bill',bill,'credit_reversed_'||document.id::text,'vendorcredit-reverse:'||document.id::text,stamp,who
 FROM ledger_entries WHERE company_id=p_company AND entity_id=document.entity_id AND id=document.posted_entry_id;
 INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,project_id,cost_center_id,customer_id,contract_id,vendor_id,description,debit_minor,credit_minor,currency_code,amount_currency_minor,exchange_rate)
 SELECT company_id,entity_id,entry,line_number,account_id,project_id,cost_center_id,customer_id,contract_id,vendor_id,left('Supplier credit correction: '||description,500),credit_minor,debit_minor,currency_code,-amount_currency_minor,exchange_rate
 FROM ledger_lines WHERE company_id=p_company AND entity_id=document.entity_id AND entry_id=document.posted_entry_id;
 PERFORM bunyra_ledger_post_entry(p_company,entry);
 INSERT INTO finance_vendor_credit_reversals(id,company_id,entity_id,credit_id,posted_entry_id,reversed_on,reason,created_by)
 VALUES(reversal,p_company,document.entity_id,document.id,entry,p_date,trim(p_reason),who);
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,'','finance.vendor_credit_reversed',jsonb_build_object('credit_id',document.id,'reversal_id',reversal,'entry_id',entry,'bill_id',bill,'amount_minor',document.amount_minor,'reversed_on',p_date,'reason',trim(p_reason)));
 RETURN reversal;
END $$;
REVOKE ALL ON FUNCTION bunyra_reverse_vendor_credit(uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_reverse_vendor_credit(uuid,uuid,date,text) TO bunyra_tenant;
CREATE FUNCTION bunyra_reverse_vendor_refund(p_company uuid,p_refund uuid,p_date date,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who text; document finance_vendor_refunds%ROWTYPE; previous finance_vendor_refund_reversals%ROWTYPE;
 bill uuid; entry uuid:=gen_random_uuid(); reversal uuid:=gen_random_uuid(); stamp text;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_date IS NULL OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'VENDOR_REVERSAL_INVALID' USING ERRCODE='P0001'; END IF;
 SELECT bill_id INTO bill FROM finance_vendor_refunds WHERE company_id=p_company AND id=p_refund;
 IF NOT FOUND THEN RAISE EXCEPTION 'VENDOR_REFUND_NOT_FOUND' USING ERRCODE='P0001'; END IF;
 -- All settlement, credit, receipt and correction operations serialize on the bill first.
 PERFORM id FROM finance_vendor_bills WHERE company_id=p_company AND id=bill FOR UPDATE;
 SELECT * INTO document FROM finance_vendor_refunds WHERE company_id=p_company AND id=p_refund;
 SELECT * INTO previous FROM finance_vendor_refund_reversals WHERE company_id=p_company AND entity_id=document.entity_id AND refund_id=p_refund;
 IF FOUND THEN
  IF previous.reversed_on<>p_date OR previous.reason<>trim(p_reason) THEN RAISE EXCEPTION 'VENDOR_REVERSAL_CONFLICT' USING ERRCODE='P0001'; END IF;
  RETURN previous.id;
 END IF;
 IF p_date<document.received_on THEN RAISE EXCEPTION 'VENDOR_REFUND_REVERSAL_BEFORE_SOURCE' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vendor-payment-entry:'||document.posted_entry_id::text,0));
 IF EXISTS(SELECT 1 FROM treasury_bank_matches m JOIN ledger_lines l ON l.company_id=m.company_id AND l.entity_id=m.entity_id AND l.id=m.ledger_line_id
  WHERE l.company_id=p_company AND l.entity_id=document.entity_id AND l.entry_id=document.posted_entry_id)
 THEN RAISE EXCEPTION 'VENDOR_REFUND_RECONCILED' USING ERRCODE='P0001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_entries WHERE company_id=p_company AND entity_id=document.entity_id AND id=document.posted_entry_id AND state='posted') THEN RAISE EXCEPTION 'VENDOR_REFUND_NOT_POSTED' USING ERRCODE='P0001'; END IF;
 stamp:=encode(sha256(convert_to(document.id::text||p_date::text||trim(p_reason),'UTF8')),'hex');
 INSERT INTO ledger_entries(id,company_id,entity_id,journal_id,entry_date,reference,description,source_type,source_id,source_event,idempotency_key,payload_hash,created_by)
 SELECT entry,p_company,document.entity_id,journal_id,p_date,left('AP-REFUND-REV:'||reference,200),trim(p_reason),'vendor_bill',bill,'refund_reversed_'||document.id::text,'vendorrefund-reverse:'||document.id::text,stamp,who
 FROM ledger_entries WHERE company_id=p_company AND entity_id=document.entity_id AND id=document.posted_entry_id;
 INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,project_id,cost_center_id,customer_id,contract_id,vendor_id,description,debit_minor,credit_minor,currency_code,amount_currency_minor,exchange_rate)
 SELECT company_id,entity_id,entry,line_number,account_id,project_id,cost_center_id,customer_id,contract_id,vendor_id,left('Supplier refund correction: '||description,500),credit_minor,debit_minor,currency_code,-amount_currency_minor,exchange_rate
 FROM ledger_lines WHERE company_id=p_company AND entity_id=document.entity_id AND entry_id=document.posted_entry_id;
 PERFORM bunyra_ledger_post_entry(p_company,entry);
 INSERT INTO finance_vendor_refund_reversals(id,company_id,entity_id,refund_id,posted_entry_id,reversed_on,reason,created_by)
 VALUES(reversal,p_company,document.entity_id,document.id,entry,p_date,trim(p_reason),who);
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,'','finance.vendor_refund_reversed',jsonb_build_object('refund_id',document.id,'reversal_id',reversal,'entry_id',entry,'bill_id',bill,'amount_minor',document.amount_minor,'reversed_on',p_date,'reason',trim(p_reason)));
 RETURN reversal;
END $$;
REVOKE ALL ON FUNCTION bunyra_reverse_vendor_refund(uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_reverse_vendor_refund(uuid,uuid,date,text) TO bunyra_tenant;
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
 IF EXISTS(SELECT 1 FROM finance_vendor_refund_reversals r JOIN finance_vendor_refunds d ON d.company_id=r.company_id AND d.entity_id=r.entity_id AND d.id=r.refund_id
  WHERE r.company_id=p_company AND r.entity_id=line.entity_id AND (d.posted_entry_id=line.entry_id OR r.posted_entry_id=line.entry_id))
 THEN RAISE EXCEPTION 'VENDOR_REFUND_REVERSED' USING ERRCODE='P0001'; END IF;
 IF EXISTS(SELECT 1 FROM finance_vendor_credit_reversals r JOIN finance_vendor_credits d ON d.company_id=r.company_id AND d.entity_id=r.entity_id AND d.id=r.credit_id
  WHERE r.company_id=p_company AND r.entity_id=line.entity_id AND (d.posted_entry_id=line.entry_id OR r.posted_entry_id=line.entry_id))
 THEN RAISE EXCEPTION 'VENDOR_CREDIT_REVERSED' USING ERRCODE='P0001'; END IF;
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

INSERT INTO schema_migrations(version) VALUES('066-supplier-credit-refund-corrections');
COMMIT;
