BEGIN;
-- 070: reuse existing crm_customers, bookings and contracts; never create parallel identities/ledgers.
ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS national_id text;
ALTER TABLE crm_customers ADD CONSTRAINT crm_customers_national_id_size
 CHECK(national_id IS NULL OR length(national_id) BETWEEN 4 AND 30);

CREATE TABLE contract_templates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 150),
 active boolean NOT NULL DEFAULT true,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id)
);
CREATE UNIQUE INDEX contract_templates_one_active ON contract_templates(company_id) WHERE active;
CREATE INDEX contract_templates_recent ON contract_templates(company_id,created_at DESC,id DESC);
CREATE TABLE contract_template_files(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 template_id uuid NOT NULL,
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 200),
 file_size integer NOT NULL CHECK(file_size BETWEEN 1 AND 5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 object_key text NOT NULL UNIQUE,
 uploaded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,template_id) REFERENCES contract_templates(company_id,id) ON DELETE RESTRICT,
 UNIQUE(company_id,template_id)
);
ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE contract_template_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_template_files FORCE ROW LEVEL SECURITY;
CREATE POLICY contract_templates_company ON contract_templates TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()))
 WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
CREATE POLICY contract_template_files_company ON contract_template_files TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()))
 WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT,UPDATE ON contract_templates TO bunyra_tenant;
GRANT SELECT,INSERT ON contract_template_files TO bunyra_tenant;
CREATE INDEX contract_template_files_lookup ON contract_template_files(company_id,template_id);
-- The booking already freezes customer_name/phone/email at signing,
-- while both bookings.customer_id and contracts.customer_id reference crm_customers.
-- Do not replace snapshots with mutable CRM fields.

INSERT INTO schema_migrations(version) VALUES('070-contract-word-templates');
COMMIT;
