-- Named company bank/cash accounts. No implicit receipt destination.
BEGIN;
CREATE TABLE company_payment_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
 entity_id uuid NOT NULL, code text NOT NULL CHECK(code ~ '^[A-Z0-9_-]{2,12}$'),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 160),
 kind text NOT NULL CHECK(kind IN('cash','bank')),
 currency_code text NOT NULL CHECK(currency_code IN('EGP','USD','EUR','GBP','SAR','AED','QAR','CHF','CAD','AUD','CNY')),
 account_id uuid NOT NULL, journal_id uuid NOT NULL, active boolean NOT NULL DEFAULT true,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), UNIQUE(company_id,entity_id,code), UNIQUE(company_id,entity_id,account_id),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id),
 FOREIGN KEY(company_id,entity_id,account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,journal_id) REFERENCES ledger_journals(company_id,entity_id,id)
);
CREATE TABLE finance_receipt_controls(
 company_id uuid NOT NULL, entity_id uuid NOT NULL, advance_account_id uuid NOT NULL,
 PRIMARY KEY(company_id,entity_id),
 FOREIGN KEY(company_id,entity_id,advance_account_id) REFERENCES ledger_accounts(company_id,entity_id,id)
);
ALTER TABLE company_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_payment_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON company_payment_accounts TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()));
ALTER TABLE finance_receipt_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_receipt_controls FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON finance_receipt_controls TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT ON company_payment_accounts,finance_receipt_controls TO bunyra_tenant;

CREATE FUNCTION bunyra_create_payment_account(p_company uuid,p_entity uuid,p_code text,p_name text,p_kind text,p_currency text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who text; account uuid; journal uuid; result uuid;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_code IS NULL OR p_code !~ '^[A-Z0-9_-]{2,12}$' OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 160
 OR p_kind IS NULL OR p_kind NOT IN('cash','bank') OR p_currency IS NULL
 OR p_currency NOT IN('EGP','USD','EUR','GBP','SAR','AED','QAR','CHF','CAD','AUD','CNY')
 THEN RAISE EXCEPTION 'PAYMENT_ACCOUNT_INVALID' USING ERRCODE='P0001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_entities WHERE company_id=p_company AND id=p_entity AND active AND is_default)
 THEN RAISE EXCEPTION 'FINANCE_ENTITY_REQUIRED' USING ERRCODE='P0001'; END IF;
 INSERT INTO ledger_accounts(company_id,entity_id,code,name,kind,role,reconcilable)
 VALUES(p_company,p_entity,'T-'||p_code,trim(p_name),'asset',p_kind,true) RETURNING id INTO account;
 INSERT INTO ledger_journals(company_id,entity_id,code,name,kind)
 VALUES(p_company,p_entity,'T-'||p_code,trim(p_name),p_kind) RETURNING id INTO journal;
 INSERT INTO company_payment_accounts(company_id,entity_id,code,name,kind,currency_code,account_id,journal_id,created_by)
 VALUES(p_company,p_entity,p_code,trim(p_name),p_kind,p_currency,account,journal,who) RETURNING id INTO result;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,'','finance.payment_account_created',jsonb_build_object('payment_account_id',result,'code',p_code,'currency',p_currency));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION bunyra_create_payment_account(uuid,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_create_payment_account(uuid,uuid,text,text,text,text) TO bunyra_tenant;

ALTER TABLE bookings ADD COLUMN payment_account_id uuid, ADD COLUMN receipt_exchange_rate numeric(20,8);
ALTER TABLE collections ADD COLUMN payment_account_id uuid, ADD COLUMN receipt_exchange_rate numeric(20,8);
ALTER TABLE bookings ADD FOREIGN KEY(company_id,payment_account_id) REFERENCES company_payment_accounts(company_id,id);
ALTER TABLE collections ADD FOREIGN KEY(company_id,payment_account_id) REFERENCES company_payment_accounts(company_id,id);
ALTER TABLE ledger_lines ADD COLUMN currency_code text NOT NULL DEFAULT 'EGP',
 ADD COLUMN amount_currency_minor bigint, ADD COLUMN exchange_rate numeric(20,8);
ALTER TABLE ledger_lines ADD CHECK((amount_currency_minor IS NULL AND exchange_rate IS NULL AND currency_code='EGP')
 OR (amount_currency_minor IS NOT NULL AND exchange_rate>0 AND currency_code ~ '^[A-Z]{3}$'
 AND round(abs(amount_currency_minor)::numeric*exchange_rate)=greatest(debit_minor,credit_minor)
 AND ((amount_currency_minor>0 AND debit_minor>0) OR (amount_currency_minor<0 AND credit_minor>0))));

CREATE FUNCTION bunyra_receipt_destination_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE account company_payment_accounts%ROWTYPE; currency text; allocation boolean:=false;
BEGIN
 IF TG_TABLE_NAME='bookings' THEN
  IF TG_OP='UPDATE' AND OLD.status='accounts_confirmed' AND
   (NEW.payment_account_id,NEW.receipt_exchange_rate,NEW.received_amount_minor) IS DISTINCT FROM
   (OLD.payment_account_id,OLD.receipt_exchange_rate,OLD.received_amount_minor)
  THEN RAISE EXCEPTION 'RECEIPT_DESTINATION_IMMUTABLE' USING ERRCODE='P0001'; END IF;
  IF NEW.status<>'accounts_confirmed' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='accounts_confirmed' THEN RETURN NEW; END IF;
  currency:=COALESCE(NEW.quote_snapshot->'book'->>'currency','EGP');
 ELSE
  IF TG_OP='UPDATE' THEN
   IF (NEW.payment_account_id,NEW.receipt_exchange_rate,NEW.amount_minor) IS DISTINCT FROM
    (OLD.payment_account_id,OLD.receipt_exchange_rate,OLD.amount_minor)
   THEN RAISE EXCEPTION 'RECEIPT_DESTINATION_IMMUTABLE' USING ERRCODE='P0001'; END IF;
   RETURN NEW;
  END IF;
  allocation:=NEW.reference='booking receipt' AND current_setting('app.booking_receipt_allocation',true)='1';
  IF allocation THEN
   SELECT b.payment_account_id,b.receipt_exchange_rate INTO NEW.payment_account_id,NEW.receipt_exchange_rate
   FROM contracts c JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
   WHERE c.company_id=NEW.company_id AND c.id=NEW.contract_id;
   RETURN NEW;
  END IF;
  SELECT COALESCE(payment_plan_snapshot->'book'->>'currency','EGP') INTO currency
   FROM contracts WHERE company_id=NEW.company_id AND id=NEW.contract_id;
 END IF;
 IF NEW.payment_account_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM finance_receipt_controls WHERE company_id=NEW.company_id)
  THEN RAISE EXCEPTION 'PAYMENT_ACCOUNT_REQUIRED' USING ERRCODE='P0001'; END IF;
  RETURN NEW; -- legacy documents remain pending until their legacy mappings are supplied
 END IF;
 SELECT * INTO account FROM company_payment_accounts WHERE company_id=NEW.company_id AND id=NEW.payment_account_id AND active FOR SHARE;
 IF NOT FOUND OR account.currency_code IS DISTINCT FROM currency
 THEN RAISE EXCEPTION 'PAYMENT_ACCOUNT_CURRENCY_MISMATCH' USING ERRCODE='P0001'; END IF;
 IF NEW.receipt_exchange_rate IS NULL OR NEW.receipt_exchange_rate<=0
 OR (currency='EGP' AND NEW.receipt_exchange_rate<>1)
 THEN RAISE EXCEPTION 'EXCHANGE_RATE_REQUIRED' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_receipt_destination_guard() FROM PUBLIC;
CREATE TRIGGER receipt_destination_guard BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION bunyra_receipt_destination_guard();
CREATE TRIGGER receipt_destination_guard BEFORE INSERT OR UPDATE ON collections FOR EACH ROW EXECUTE FUNCTION bunyra_receipt_destination_guard();

-- A BEFORE event trigger enriches the trusted source event before immediate posting runs.
CREATE FUNCTION bunyra_finance_currency_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE destination uuid; rate numeric; currency text; original finance_events%ROWTYPE; collection uuid; booking uuid; original_amount bigint;
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
  NEW.amount_minor:=round(original_amount::numeric*rate)::bigint;
  IF NEW.amount_minor<=0 THEN RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE='P0001'; END IF;
  NEW.payload:=NEW.payload||jsonb_build_object('payment_account_id',destination,'currency_code',currency,
   'native_amount_minor',original_amount::text,'exchange_rate',rate::text,'valuation','historical_receipt_rate');
 ELSIF EXISTS(SELECT 1 FROM finance_receipt_controls WHERE company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'PAYMENT_ACCOUNT_REQUIRED' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_finance_currency_snapshot() FROM PUBLIC;
CREATE TRIGGER finance_currency_snapshot BEFORE INSERT ON finance_events FOR EACH ROW EXECUTE FUNCTION bunyra_finance_currency_snapshot();
INSERT INTO schema_migrations(version) VALUES('056-company-payment-accounts');
COMMIT;
