BEGIN;
ALTER TABLE member_permissions DROP CONSTRAINT member_permissions_action_check;
ALTER TABLE member_permissions ADD CONSTRAINT member_permissions_action_check CHECK(action IN('company.read','company.write','projects.read','projects.write','plans.publish','inventory.read','inventory.write','pricing.read','pricing.write','pricing.approve','leads.read','leads.write','bookings.read','bookings.create','bookings.approve','bookings.cancel','finance.read','finance.write','finance.approve','members.manage','accounts.manage','roles.manage','audit.read','offers.create','contracts.write','commissions.write','commissions.read','commissions.pay','reports.read'));
ALTER TABLE contracts ADD COLUMN commission_sales_user_id text;
UPDATE contracts c SET commission_sales_user_id=b.sales_user_id FROM bookings b WHERE b.company_id=c.company_id AND b.id=c.booking_id;
ALTER TABLE contracts ALTER COLUMN commission_sales_user_id SET NOT NULL;
ALTER TABLE contracts ADD COLUMN commission_rate_bps integer NOT NULL DEFAULT 0 CHECK(commission_rate_bps BETWEEN 0 AND 10000),
 ADD COLUMN commission_threshold_bps integer NOT NULL DEFAULT 10000 CHECK(commission_threshold_bps BETWEEN 0 AND 10000),
 ADD COLUMN commission_total_minor bigint NOT NULL DEFAULT 0 CHECK(commission_total_minor>=0),
 ADD COLUMN commission_configured boolean NOT NULL DEFAULT false,
 ADD COLUMN commission_version integer NOT NULL DEFAULT 1 CHECK(commission_version>0),
 ADD COLUMN commission_currency text NOT NULL DEFAULT 'EGP';
UPDATE contracts SET commission_currency=COALESCE(payment_plan_snapshot->'book'->>'currency','EGP');
CREATE FUNCTION bunyra_contract_commission_terms() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT sales_user_id INTO NEW.commission_sales_user_id FROM bookings WHERE company_id=NEW.company_id AND id=NEW.booking_id;
  NEW.commission_currency=COALESCE(NEW.payment_plan_snapshot->'book'->>'currency','EGP');
 ELSE
  IF NEW.commission_sales_user_id IS DISTINCT FROM OLD.commission_sales_user_id OR NEW.commission_currency<>OLD.commission_currency OR NEW.company_id<>OLD.company_id OR NEW.project_id<>OLD.project_id OR NEW.booking_id<>OLD.booking_id OR NEW.value_final_minor<>OLD.value_final_minor THEN RAISE EXCEPTION 'COMMISSION_TERMS_IMMUTABLE'; END IF;
  IF (NEW.commission_rate_bps,NEW.commission_threshold_bps,NEW.commission_total_minor,NEW.commission_configured,NEW.commission_version) IS DISTINCT FROM (OLD.commission_rate_bps,OLD.commission_threshold_bps,OLD.commission_total_minor,OLD.commission_configured,OLD.commission_version) THEN
   IF current_setting('app.commission_terms',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'COMMISSION_TERMS_IMMUTABLE'; END IF;
   IF OLD.commission_configured AND (NEW.commission_rate_bps<>OLD.commission_rate_bps OR NOT NEW.commission_configured) THEN RAISE EXCEPTION 'COMMISSION_TERMS_IMMUTABLE'; END IF;
   NEW.commission_version=OLD.commission_version+1;
  END IF;
 END IF;
 NEW.commission_total_minor=round(NEW.value_final_minor::numeric*NEW.commission_rate_bps/10000)::bigint;
 RETURN NEW;
END $$;
CREATE TRIGGER contract_commission_terms BEFORE INSERT OR UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION bunyra_contract_commission_terms();
CREATE TABLE commission_ledger(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,contract_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('payment','recovery')),amount_minor bigint NOT NULL CHECK(amount_minor>0),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),reference text NOT NULL DEFAULT '',
 request_id uuid NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,contract_id) REFERENCES contracts(company_id,id),UNIQUE(company_id,request_id)
);
CREATE INDEX commission_ledger_contract ON commission_ledger(company_id,contract_id,created_at);
CREATE INDEX commission_contract_report ON contracts(company_id,commission_sales_user_id,signed_at);
CREATE INDEX booking_sales_report ON bookings(company_id,sales_user_id,created_at);
ALTER TABLE commission_ledger ENABLE ROW LEVEL SECURITY; ALTER TABLE commission_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY commission_scope ON commission_ledger TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT ON commission_ledger TO bunyra_tenant;
CREATE FUNCTION bunyra_commission_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF current_setting('app.commission_posting',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'COMMISSION_POSTING_REQUIRED'; END IF; RETURN NEW;
 END IF;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id AND status='deleted' AND purged_at IS NOT NULL) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'COMMISSION_LEDGER_IMMUTABLE';
END $$;
CREATE TRIGGER commission_immutable BEFORE INSERT OR UPDATE OR DELETE ON commission_ledger FOR EACH ROW EXECUTE FUNCTION bunyra_commission_immutable();
CREATE VIEW commission_balances WITH(security_invoker=true) AS
 WITH totals AS(
 SELECT c.*,
 GREATEST(0,COALESCE((SELECT sum(r.amount_minor) FROM collections r WHERE r.company_id=c.company_id AND r.contract_id=c.id AND r.status='confirmed'),0)-COALESCE((SELECT sum(a.amount_minor) FROM financial_adjustments a WHERE a.company_id=c.company_id AND a.contract_id=c.id AND a.status='executed' AND a.kind IN('refund','reversal')),0))::bigint AS net_collected_minor,
 COALESCE((SELECT sum(CASE WHEN l.kind='payment' THEN l.amount_minor ELSE -l.amount_minor END) FROM commission_ledger l WHERE l.company_id=c.company_id AND l.contract_id=c.id),0)::bigint AS net_paid_minor
 FROM contracts c),
 earned AS(SELECT totals.*,CASE WHEN commission_configured AND status<>'cancelled' AND net_collected_minor::numeric*10000>=value_final_minor::numeric*commission_threshold_bps THEN commission_total_minor ELSE 0 END AS earned_minor FROM totals)
 SELECT earned.*,GREATEST(0,earned_minor-net_paid_minor)::bigint AS payable_minor,GREATEST(0,net_paid_minor-earned_minor)::bigint AS recoverable_minor FROM earned;
GRANT SELECT ON commission_balances TO bunyra_tenant;
CREATE FUNCTION bunyra_post_commission(c uuid,k uuid,entry_kind text,amount bigint,request_key uuid,entry_reason text,entry_reference text,actor text,actor_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE balance record; previous commission_ledger; result commission_ledger;
BEGIN
 PERFORM id FROM contracts WHERE company_id=c AND id=k FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO previous FROM commission_ledger WHERE company_id=c AND request_id=request_key;
 IF FOUND THEN
  IF previous.contract_id<>k OR previous.kind<>entry_kind OR previous.amount_minor<>amount OR previous.reason<>entry_reason OR previous.reference<>entry_reference OR previous.created_by<>actor THEN RAISE EXCEPTION 'COMMISSION_REQUEST_CONFLICT'; END IF;
  RETURN to_jsonb(previous)||jsonb_build_object('amount_minor',previous.amount_minor::text);
 END IF;
 SELECT * INTO balance FROM commission_balances WHERE company_id=c AND id=k;
 IF amount<=0 OR entry_kind NOT IN('payment','recovery') THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
 IF (entry_kind='payment' AND amount>balance.payable_minor) OR (entry_kind='recovery' AND amount>balance.recoverable_minor) THEN RAISE EXCEPTION 'COMMISSION_BALANCE_CHANGED'; END IF;
 PERFORM set_config('app.commission_posting','1',true);
 INSERT INTO commission_ledger(company_id,contract_id,kind,amount_minor,reason,reference,request_id,created_by) VALUES(c,k,entry_kind,amount,entry_reason,entry_reference,request_key,actor) RETURNING * INTO result;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(c,actor,actor_email,'commission.'||entry_kind,to_jsonb(result));
 RETURN to_jsonb(result)||jsonb_build_object('amount_minor',result.amount_minor::text);
END $$;
REVOKE ALL ON FUNCTION bunyra_post_commission(uuid,uuid,text,bigint,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_post_commission(uuid,uuid,text,bigint,uuid,text,text,text,text) TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('028-commissions-reports');
COMMIT;
