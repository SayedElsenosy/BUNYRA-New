BEGIN;
ALTER TABLE buyer_requests ADD CONSTRAINT buyer_request_customer_key UNIQUE(company_id,customer_id,id);
CREATE TABLE sales_offers(
 id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid NOT NULL,unit_id uuid NOT NULL,customer_id uuid,source_request_id uuid,
 book_id uuid NOT NULL,plan_id uuid NOT NULL,source_unit_version integer NOT NULL CHECK(source_unit_version>0),
 offer_number text NOT NULL,quote_date date NOT NULL,language text NOT NULL CHECK(language IN('ar','en')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),currency text NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),object_key text NOT NULL,byte_size integer NOT NULL CHECK(byte_size BETWEEN 8 AND 5242880),sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'uploading' CHECK(status IN('uploading','ready','failed')),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),UNIQUE(company_id,offer_number),UNIQUE(object_key),
 CHECK(source_request_id IS NULL OR customer_id IS NOT NULL),
 FOREIGN KEY(company_id,project_id,unit_id) REFERENCES inventory_units(company_id,project_id,id),
 FOREIGN KEY(company_id,customer_id) REFERENCES crm_customers(company_id,id),
 FOREIGN KEY(company_id,customer_id,source_request_id) REFERENCES buyer_requests(company_id,customer_id,id),
 FOREIGN KEY(company_id,project_id,book_id,plan_id) REFERENCES price_book_plans(company_id,project_id,book_id,id)
);
CREATE INDEX sales_offers_customer ON sales_offers(company_id,customer_id,created_at DESC,id);
CREATE INDEX sales_offers_rep ON sales_offers(company_id,created_by,created_at DESC,id);
ALTER TABLE sales_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY offer_company_scope ON sales_offers TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT,UPDATE ON sales_offers TO bunyra_tenant;
CREATE FUNCTION bunyra_offer_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id AND status='deleted' AND purged_at IS NOT NULL) THEN RETURN OLD; END IF;
 ELSE
  IF OLD.status='uploading' AND NEW.status IN('ready','failed') AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'OFFER_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER offer_immutable BEFORE UPDATE OR DELETE ON sales_offers FOR EACH ROW EXECUTE FUNCTION bunyra_offer_immutable();

ALTER TABLE bookings ADD COLUMN source_offer_id uuid,ADD COLUMN source_request_id uuid;
ALTER TABLE bookings ADD FOREIGN KEY(company_id,source_offer_id) REFERENCES sales_offers(company_id,id),
 ADD FOREIGN KEY(company_id,customer_id,source_request_id) REFERENCES buyer_requests(company_id,customer_id,id);
CREATE FUNCTION bunyra_booking_offer_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.source_offer_id,NEW.source_request_id) IS DISTINCT FROM (OLD.source_offer_id,OLD.source_request_id) THEN RAISE EXCEPTION 'BOOKING_SOURCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF (OLD.source_offer_id IS NOT NULL OR OLD.source_request_id IS NOT NULL) AND (NEW.company_id,NEW.project_id,NEW.unit_id,NEW.customer_id,NEW.book_id,NEW.plan_id) IS DISTINCT FROM (OLD.company_id,OLD.project_id,OLD.unit_id,OLD.customer_id,OLD.book_id,OLD.plan_id) THEN RAISE EXCEPTION 'BOOKING_SOURCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.quote_snapshot->>'source_offer_id') IS DISTINCT FROM NEW.source_offer_id::text OR (NEW.quote_snapshot->>'source_request_id') IS DISTINCT FROM NEW.source_request_id::text THEN RAISE EXCEPTION 'INVALID_JOURNEY_SOURCE' USING ERRCODE='23514'; END IF;
 IF NEW.source_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM buyer_requests r WHERE r.company_id=NEW.company_id AND r.customer_id=NEW.customer_id AND r.id=NEW.source_request_id AND (r.project_id IS NULL OR r.project_id=NEW.project_id)) THEN RAISE EXCEPTION 'INVALID_JOURNEY_SOURCE' USING ERRCODE='23514'; END IF;
 IF NEW.source_offer_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM sales_offers o JOIN project_pricing p ON p.company_id=o.company_id AND p.project_id=o.project_id AND p.book_id=o.book_id
  WHERE o.company_id=NEW.company_id AND o.id=NEW.source_offer_id AND o.status='ready'
  AND o.customer_id=NEW.customer_id AND o.project_id=NEW.project_id AND o.unit_id=NEW.unit_id AND o.plan_id=NEW.plan_id AND o.book_id=NEW.book_id
  AND o.source_request_id IS NOT DISTINCT FROM NEW.source_request_id
  AND o.quote_date=(NEW.quote_snapshot->>'date')::date AND o.source_unit_version=(NEW.quote_snapshot->'unit'->>'version')::integer
  AND o.snapshot->'quote'->'calculation'=NEW.quote_snapshot->'calculation'
 ) THEN RAISE EXCEPTION 'OFFER_PRICE_CHANGED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_offer_source BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION bunyra_booking_offer_source();
INSERT INTO schema_migrations(version) VALUES('029-saved-offers');
COMMIT;
