CREATE TABLE project_setups (
 company_id uuid NOT NULL,
 project_id uuid PRIMARY KEY,
 configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),
 CHECK(jsonb_typeof(configuration)='object')
);
ALTER TABLE project_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_setups FORCE ROW LEVEL SECURITY;
GRANT SELECT ON project_setups TO bunyra_tenant;
CREATE POLICY project_setups_tenant ON project_setups FOR SELECT TO bunyra_tenant USING(company_id=nullif(current_setting('app.company_id',true),'')::uuid AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));

CREATE UNIQUE INDEX project_setup_code ON project_setups(company_id,lower(configuration->>'code'));
INSERT INTO schema_migrations(version) VALUES('004-project-setup');
