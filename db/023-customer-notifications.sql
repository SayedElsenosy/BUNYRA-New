BEGIN;
ALTER TABLE financial_adjustments ADD CONSTRAINT financial_adjustments_company_id_id UNIQUE(company_id,id);
CREATE TABLE customer_notifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,customer_id uuid NOT NULL,booking_id uuid,contract_id uuid,adjustment_id uuid,event_key text NOT NULL,channel text NOT NULL DEFAULT 'email' CHECK(channel IN('email','webhook')),recipient text NOT NULL,subject text NOT NULL,body text NOT NULL,payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sent','failed','cancelled')),attempts integer NOT NULL DEFAULT 0,last_error text,sent_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,customer_id) REFERENCES crm_customers(company_id,id),FOREIGN KEY(company_id,booking_id) REFERENCES bookings(company_id,id),FOREIGN KEY(company_id,contract_id) REFERENCES contracts(company_id,id),FOREIGN KEY(company_id,adjustment_id) REFERENCES financial_adjustments(company_id,id),UNIQUE(company_id,event_key,channel)
);
CREATE INDEX customer_notifications_status ON customer_notifications(company_id,status,created_at);
ALTER TABLE customer_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_notifications_scope ON customer_notifications TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT,UPDATE ON customer_notifications TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('023-customer-notifications');
COMMIT;
