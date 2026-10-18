ALTER TABLE inventory_units ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object');
ALTER TABLE project_plan_files ADD CONSTRAINT project_plan_files_tenant_id UNIQUE(company_id,project_id,id);
CREATE TABLE plan_layouts(
 file_id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),published boolean NOT NULL DEFAULT false,
 updated_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,project_id,file_id) REFERENCES project_plan_files(company_id,project_id,id),
 UNIQUE(company_id,project_id,file_id)
);
CREATE TABLE plan_unit_shapes(
 company_id uuid NOT NULL,project_id uuid NOT NULL,file_id uuid NOT NULL,unit_id uuid NOT NULL,
 page integer NOT NULL CHECK(page BETWEEN 1 AND 200),points jsonb NOT NULL CHECK(jsonb_typeof(points)='array' AND jsonb_array_length(points) BETWEEN 3 AND 64),
 PRIMARY KEY(file_id,unit_id),
 FOREIGN KEY(company_id,project_id,file_id) REFERENCES plan_layouts(company_id,project_id,file_id),
 FOREIGN KEY(company_id,project_id,unit_id) REFERENCES inventory_units(company_id,project_id,id)
);
ALTER TABLE plan_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_layouts FORCE ROW LEVEL SECURITY;
ALTER TABLE plan_unit_shapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_unit_shapes FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_layouts_scope ON plan_layouts FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
CREATE POLICY plan_shapes_scope ON plan_unit_shapes FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
GRANT SELECT ON plan_layouts,plan_unit_shapes TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('008-unit-details-plan-layouts');
