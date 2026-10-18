CREATE TABLE inventory_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,project_id uuid NOT NULL,
 payload_hash text NOT NULL,source_name text NOT NULL,unit_count integer NOT NULL CHECK(unit_count BETWEEN 1 AND 1000),
 actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),UNIQUE(company_id,project_id,payload_hash)
);
CREATE TABLE project_plan_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,project_id uuid NOT NULL,
 title text NOT NULL,building text NOT NULL,floor text NOT NULL,kind text NOT NULL CHECK(kind IN('pdf','dwg','dxf')),
 original_name text NOT NULL,object_key text NOT NULL UNIQUE,byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 20971520),
 sha256 text NOT NULL,version integer NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN('uploading','ready','rejected')),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),
 UNIQUE(company_id,project_id,building,floor,kind,version)
);
ALTER TABLE inventory_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_imports FORCE ROW LEVEL SECURITY;
ALTER TABLE project_plan_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_plan_files FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_imports_scope ON inventory_imports FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
CREATE POLICY plan_files_scope ON project_plan_files FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
GRANT SELECT ON inventory_imports,project_plan_files TO bunyra_tenant;
CREATE INDEX project_plan_files_list ON project_plan_files(company_id,project_id,created_at DESC);
INSERT INTO schema_migrations(version) VALUES('006-files-imports');
