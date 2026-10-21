BEGIN;
CREATE TABLE quarterly_sales_targets(
 company_id uuid NOT NULL REFERENCES companies(id),
 user_id text NOT NULL,
 quarter_start date NOT NULL CHECK(extract(day FROM quarter_start)=1 AND extract(month FROM quarter_start) IN(1,4,7,10)),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 target_minor bigint NOT NULL CHECK(target_minor>0 AND target_minor<=9999999999999999),
 version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,user_id,quarter_start),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
);
ALTER TABLE quarterly_sales_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_sales_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY quarterly_sales_targets_tenant ON quarterly_sales_targets TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT,UPDATE ON quarterly_sales_targets TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('037-quarterly-sales-targets');
COMMIT;
