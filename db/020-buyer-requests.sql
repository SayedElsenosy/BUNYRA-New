BEGIN;

CREATE TABLE buyer_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 project_id uuid,
 unit_category text NOT NULL DEFAULT '' CHECK(length(unit_category)<=120),
 min_area numeric(12,2) CHECK(min_area IS NULL OR min_area>0),
 max_area numeric(12,2) CHECK(max_area IS NULL OR max_area>0),
 max_budget_minor bigint CHECK(max_budget_minor IS NULL OR max_budget_minor>0),
 payment_plan_code text NOT NULL DEFAULT '' CHECK(length(payment_plan_code)<=40),
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','matched','converted','closed')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,customer_id) REFERENCES crm_customers(company_id,id),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),
 CHECK(min_area IS NULL OR max_area IS NULL OR min_area<=max_area)
);
CREATE INDEX buyer_requests_company_status ON buyer_requests(company_id,status,updated_at DESC);
CREATE INDEX buyer_requests_customer ON buyer_requests(company_id,customer_id,updated_at DESC);
ALTER TABLE buyer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY buyer_requests_scope ON buyer_requests TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT,UPDATE ON buyer_requests TO bunyra_tenant;

INSERT INTO schema_migrations(version) VALUES('020-buyer-requests');
COMMIT;
