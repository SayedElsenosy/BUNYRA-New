BEGIN;
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
  RETURN previous.id;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(normalized) AS x(bill_line_id uuid,amount_minor bigint)
  JOIN finance_vendor_bill_lines l ON l.company_id=p_company AND l.entity_id=bill.entity_id AND l.bill_id=bill.id AND l.id=x.bill_line_id
  WHERE x.amount_minor::numeric+coalesce((SELECT sum(c.amount_minor::numeric) FROM finance_vendor_credit_lines c
   WHERE c.company_id=p_company AND c.entity_id=bill.entity_id AND c.bill_line_id=l.id),0)>l.amount_minor)
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
  RETURN previous.id;
 END IF;
 IF p_date<credit.credit_date THEN RAISE EXCEPTION 'VENDOR_REFUND_BEFORE_CREDIT' USING ERRCODE='P0001'; END IF;
 SELECT b.refundable_minor INTO refundable FROM finance_vendor_bill_balances b WHERE b.company_id=p_company AND b.bill_id=credit.bill_id;
 -- A backdated receipt may not borrow refund capacity from later-dated payments or credits.
 SELECT least(refundable,greatest(
  coalesce((SELECT sum(p.amount_minor::numeric) FROM finance_vendor_payments p
    WHERE p.company_id=p_company AND p.entity_id=credit.entity_id AND p.bill_id=credit.bill_id AND p.paid_on<=p_date
     AND NOT EXISTS(SELECT 1 FROM finance_vendor_payment_reversals x WHERE x.company_id=p.company_id AND x.entity_id=p.entity_id AND x.payment_id=p.id)),0)
  -coalesce((SELECT sum(r.amount_minor::numeric) FROM finance_vendor_refunds r WHERE r.company_id=p_company AND r.entity_id=credit.entity_id AND r.bill_id=credit.bill_id),0)
  -(SELECT b.total_minor FROM finance_vendor_bills b WHERE b.company_id=p_company AND b.id=credit.bill_id)
  +coalesce((SELECT sum(c.amount_minor::numeric) FROM finance_vendor_credits c WHERE c.company_id=p_company AND c.entity_id=credit.entity_id AND c.bill_id=credit.bill_id AND c.credit_date<=p_date),0),0)) INTO refundable;
 SELECT coalesce(sum(r.amount_minor::numeric),0) INTO refunded FROM finance_vendor_refunds r WHERE r.company_id=p_company AND r.entity_id=credit.entity_id AND r.credit_id=p_credit;
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
INSERT INTO schema_migrations(version) VALUES('065-supplier-credit-source-lines');
COMMIT;
