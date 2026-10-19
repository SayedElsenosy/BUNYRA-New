BEGIN;
ALTER TABLE plan_layout_revisions ADD COLUMN inventory_change jsonb CHECK(inventory_change IS NULL OR jsonb_typeof(inventory_change)='object');
CREATE TABLE unit_lineage(
 company_id uuid NOT NULL,project_id uuid NOT NULL,revision_id uuid NOT NULL,parent_unit_id uuid NOT NULL,child_unit_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('split','merge')),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,parent_unit_id,child_unit_id),
 FOREIGN KEY(company_id,project_id,parent_unit_id) REFERENCES inventory_units(company_id,project_id,id),
 FOREIGN KEY(company_id,project_id,child_unit_id) REFERENCES inventory_units(company_id,project_id,id),
 FOREIGN KEY(revision_id) REFERENCES plan_layout_revisions(id),
 CHECK(parent_unit_id<>child_unit_id)
);
ALTER TABLE unit_lineage ENABLE ROW LEVEL SECURITY;ALTER TABLE unit_lineage FORCE ROW LEVEL SECURITY;
CREATE POLICY lineage_scope ON unit_lineage TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()) AND bunyra_plan_can('plans.publish',company_id,project_id));
GRANT SELECT,INSERT ON unit_lineage TO bunyra_tenant;
CREATE FUNCTION bunyra_lineage_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id AND status='deleted' AND purged_at IS NOT NULL) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'UNIT_LINEAGE_IMMUTABLE';
END $$;
CREATE TRIGGER unit_lineage_immutable BEFORE UPDATE OR DELETE ON unit_lineage FOR EACH ROW EXECUTE FUNCTION bunyra_lineage_immutable();
INSERT INTO schema_migrations(version) VALUES('026-unit-lineage');
COMMIT;
