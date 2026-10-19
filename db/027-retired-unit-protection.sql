BEGIN;
CREATE FUNCTION bunyra_retired_unit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM unit_lineage WHERE company_id=OLD.company_id AND project_id=OLD.project_id AND parent_unit_id=OLD.id) THEN RAISE EXCEPTION 'UNIT_RETIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER unit_retired_guard BEFORE UPDATE ON inventory_units FOR EACH ROW EXECUTE FUNCTION bunyra_retired_unit_guard();
INSERT INTO schema_migrations(version) VALUES('027-retired-unit-protection');
COMMIT;
