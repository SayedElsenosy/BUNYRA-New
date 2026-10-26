BEGIN;
-- Phase 1 of Real-Estate-Workspace engine merge.
-- BUNYRA already owns projects(company_id,id) and inventory_units(company_id,project_id,id).
-- Reuse them: never create competing inventory/booking sources of truth.
-- company_id is the BUNYRA tenant identifier (equivalent to legacy tenant_id).

CREATE TABLE phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, id),
  UNIQUE (company_id, project_id, name),
  CONSTRAINT phases_project_scope_fk FOREIGN KEY (company_id, project_id)
    REFERENCES projects(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  phase_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, id),
  UNIQUE (company_id, project_id, phase_id, name),
  CONSTRAINT buildings_phase_scope_fk FOREIGN KEY (company_id, project_id, phase_id)
    REFERENCES phases(company_id, project_id, id) ON DELETE RESTRICT
);

-- One-to-one geometry/building extension of EXISTING inventory_units.
-- Never duplicate unit status, price, or identity. id must be an existing inventory_units.id.
-- This protects the existing price books, existing bookings, unique-booking guard,
-- unit-status triggers and accounting integrations.
CREATE TABLE units (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  building_id uuid NOT NULL,
  svg_coordinates jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, project_id, id),
  CONSTRAINT units_inventory_scope_fk FOREIGN KEY(company_id, project_id, id)
    REFERENCES inventory_units(company_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT units_building_scope_fk FOREIGN KEY(company_id, project_id, building_id)
    REFERENCES buildings(company_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT units_coordinates_object CHECK(
    svg_coordinates IS NULL OR jsonb_typeof(svg_coordinates)='object'
  )
);

CREATE INDEX phases_company_project_idx ON phases(company_id, project_id);
CREATE INDEX buildings_company_phase_idx ON buildings(company_id, project_id, phase_id);
CREATE INDEX units_company_building_idx ON units(company_id, project_id, building_id);

DO $rls$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['phases','buildings','units'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tab);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I TO bunyra_tenant
       USING (company_id = (SELECT bunyra_tenant_company()))
       WITH CHECK (company_id = (SELECT bunyra_tenant_company()))',tab);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',tab);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO bunyra_tenant',tab);
  END LOOP;
END $rls$;

-- No direct UPDATE/DELETE of the canonical inventory via the new hierarchy.
-- Existing inventory_unit committed-state protections remain untouched.
INSERT INTO schema_migrations(version) VALUES('067-workspace-inventory-hierarchy');
COMMIT;
