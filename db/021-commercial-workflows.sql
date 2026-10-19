BEGIN;

CREATE OR REPLACE FUNCTION bunyra_protect_committed_unit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.status IN('pending','reserved','sold') AND current_setting('app.booking_transition',true)<>'1' THEN RAISE EXCEPTION 'UNIT_COMMITTED' USING ERRCODE='23514'; END IF;
 IF NEW.company_id<>OLD.company_id OR NEW.project_id<>OLD.project_id THEN RAISE EXCEPTION 'UNIT_SCOPE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE TABLE bookings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,project_id uuid NOT NULL,unit_id uuid NOT NULL,UNIQUE(company_id,id),
 customer_id uuid NOT NULL,lead_id uuid,book_id uuid NOT NULL,plan_id uuid NOT NULL,status text NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','approved','rejected','cancelled','accounts_pending','accounts_confirmed')),
 customer_name text NOT NULL,customer_phone text NOT NULL,customer_email text NOT NULL DEFAULT '',correspondence_address text NOT NULL DEFAULT '',
 id_document_key text NOT NULL DEFAULT '',payment_proof_key text NOT NULL DEFAULT '',requested_amount_minor bigint NOT NULL CHECK(requested_amount_minor>=0),reservation_amount_minor bigint NOT NULL CHECK(reservation_amount_minor>=0),received_amount_minor bigint NOT NULL DEFAULT 0 CHECK(received_amount_minor>=0),notes text NOT NULL DEFAULT '',
 sales_user_id text NOT NULL,operations_user_id text,operations_at timestamptz,accounts_user_id text,accounts_at timestamptz,rejection_reason text,cancellation_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,project_id,unit_id) REFERENCES inventory_units(company_id,project_id,id),FOREIGN KEY(company_id,customer_id) REFERENCES crm_customers(company_id,id),FOREIGN KEY(company_id,lead_id) REFERENCES crm_leads(company_id,id),FOREIGN KEY(company_id,project_id,book_id,plan_id) REFERENCES price_book_plans(company_id,project_id,book_id,id)
);
CREATE UNIQUE INDEX bookings_active_unit ON bookings(company_id,unit_id) WHERE status IN('submitted','approved','accounts_pending','accounts_confirmed');
CREATE INDEX bookings_company_status ON bookings(company_id,status,created_at DESC);
CREATE INDEX bookings_customer ON bookings(company_id,customer_id,created_at DESC);

CREATE TABLE contracts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,booking_id uuid NOT NULL UNIQUE,customer_id uuid NOT NULL,project_id uuid NOT NULL,unit_id uuid NOT NULL,UNIQUE(company_id,id),status text NOT NULL DEFAULT 'active' CHECK(status IN('active','cancelled','completed')),
 contract_number text NOT NULL,value_final_minor bigint NOT NULL CHECK(value_final_minor>0),payment_plan_snapshot jsonb NOT NULL CHECK(jsonb_typeof(payment_plan_snapshot)='object'),signed_at timestamptz NOT NULL DEFAULT now(),cancelled_at timestamptz,cancellation_reason text,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,booking_id) REFERENCES bookings(company_id,id),FOREIGN KEY(company_id,customer_id) REFERENCES crm_customers(company_id,id),FOREIGN KEY(company_id,project_id,unit_id) REFERENCES inventory_units(company_id,project_id,id),UNIQUE(company_id,contract_number)
);
CREATE TABLE contract_installments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,contract_id uuid NOT NULL,number integer NOT NULL CHECK(number>0),due_date date NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),paid_minor bigint NOT NULL DEFAULT 0 CHECK(paid_minor>=0 AND paid_minor<=amount_minor),status text NOT NULL DEFAULT 'due' CHECK(status IN('due','partial','paid','waived')),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,id),
 FOREIGN KEY(company_id,contract_id) REFERENCES contracts(company_id,id),UNIQUE(contract_id,number)
);
CREATE TABLE collections(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,contract_id uuid NOT NULL,installment_id uuid NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),received_at timestamptz NOT NULL DEFAULT now(),reference text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'confirmed' CHECK(status IN('confirmed','voided')),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,contract_id) REFERENCES contracts(company_id,id),FOREIGN KEY(company_id,installment_id) REFERENCES contract_installments(company_id,id)
);
CREATE INDEX contract_installments_due ON contract_installments(company_id,status,due_date);
CREATE INDEX collections_contract ON collections(company_id,contract_id,received_at DESC);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['bookings','contracts','contract_installments','collections'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY commercial_scope ON %1$I TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()))',t); END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE ON bookings,contracts,contract_installments,collections TO bunyra_tenant;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO bunyra_tenant;

INSERT INTO schema_migrations(version) VALUES('021-commercial-workflows');
COMMIT;
