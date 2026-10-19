BEGIN;

CREATE TABLE crm_customers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 full_name text NOT NULL CHECK(length(trim(full_name)) BETWEEN 2 AND 160),
 phone text NOT NULL CHECK(length(trim(phone)) BETWEEN 3 AND 40),
 email text NOT NULL DEFAULT '' CHECK(length(email)<=254),
 address text NOT NULL DEFAULT '' CHECK(length(address)<=500),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 normalized_phone text NOT NULL,
 normalized_email text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 UNIQUE(company_id,normalized_phone),
 UNIQUE(company_id,normalized_email)
);
CREATE INDEX crm_customers_company_name ON crm_customers(company_id,lower(full_name));
CREATE INDEX crm_customers_company_updated ON crm_customers(company_id,updated_at DESC);

CREATE TABLE crm_leads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 customer_id uuid NOT NULL,
 source text NOT NULL DEFAULT 'other' CHECK(length(trim(source)) BETWEEN 2 AND 80),
 status text NOT NULL DEFAULT 'new' CHECK(status IN('new','contacted','qualified','proposal','won','lost','paused')),
 owner_user_id text NOT NULL,
 project_id uuid,
 interest text NOT NULL DEFAULT '' CHECK(length(interest)<=1000),
 lost_reason text NOT NULL DEFAULT '' CHECK(length(lost_reason)<=500),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,customer_id) REFERENCES crm_customers(company_id,id),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id)
);
CREATE INDEX crm_leads_company_status ON crm_leads(company_id,status,updated_at DESC);
CREATE INDEX crm_leads_company_owner ON crm_leads(company_id,owner_user_id,status);
CREATE INDEX crm_leads_company_project ON crm_leads(company_id,project_id,status);

CREATE TABLE crm_interactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 customer_id uuid NOT NULL,
 lead_id uuid,
 kind text NOT NULL CHECK(kind IN('call','meeting','whatsapp','email','note')),
 body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 3000),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,customer_id) REFERENCES crm_customers(company_id,id),
 FOREIGN KEY(company_id,lead_id) REFERENCES crm_leads(company_id,id)
);
CREATE INDEX crm_interactions_customer_time ON crm_interactions(company_id,customer_id,created_at DESC);

CREATE TABLE crm_follow_ups(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 customer_id uuid NOT NULL,
 lead_id uuid,
 due_at timestamptz NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 160),
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','done','cancelled')),
 assigned_to text NOT NULL,
 created_by text NOT NULL,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,customer_id) REFERENCES crm_customers(company_id,id),
 FOREIGN KEY(company_id,lead_id) REFERENCES crm_leads(company_id,id)
);
CREATE INDEX crm_follow_ups_due ON crm_follow_ups(company_id,status,due_at);

GRANT SELECT,INSERT,UPDATE ON crm_customers,crm_leads,crm_interactions,crm_follow_ups TO bunyra_tenant;
ALTER TABLE crm_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_customers FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_interactions FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_follow_ups FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_customers_scope ON crm_customers TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
CREATE POLICY crm_leads_scope ON crm_leads TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
CREATE POLICY crm_interactions_scope ON crm_interactions TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
CREATE POLICY crm_follow_ups_scope ON crm_follow_ups TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));

INSERT INTO schema_migrations(version) VALUES('017-crm-foundation');
COMMIT;
