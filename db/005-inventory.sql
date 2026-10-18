CREATE TABLE inventory_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,project_id uuid NOT NULL,
 code text NOT NULL,building text NOT NULL,floor text NOT NULL,category text NOT NULL,
 area numeric(12,2) NOT NULL CHECK(area>0),proposed_price_minor bigint NOT NULL CHECK(proposed_price_minor>=0),
 status text NOT NULL DEFAULT 'available' CHECK(status IN('available','unavailable','pending','reserved','sold')),
 active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),UNIQUE(company_id,project_id,id)
);
CREATE UNIQUE INDEX inventory_unit_code ON inventory_units(company_id,project_id,lower(code));
CREATE TABLE unit_status_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,company_id uuid NOT NULL,project_id uuid NOT NULL,unit_id uuid NOT NULL,
 previous_status text,next_status text NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,project_id,unit_id) REFERENCES inventory_units(company_id,project_id,id)
);
CREATE FUNCTION bunyra_protect_committed_unit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.status IN('pending','reserved','sold') THEN RAISE EXCEPTION 'UNIT_COMMITTED' USING ERRCODE='23514'; END IF;
 IF NEW.company_id<>OLD.company_id OR NEW.project_id<>OLD.project_id THEN RAISE EXCEPTION 'UNIT_SCOPE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_protection BEFORE UPDATE ON inventory_units FOR EACH ROW EXECUTE FUNCTION bunyra_protect_committed_unit();
ALTER TABLE inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_units FORCE ROW LEVEL SECURITY;
ALTER TABLE unit_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_scope ON inventory_units FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
CREATE POLICY unit_history_scope ON unit_status_history FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
GRANT SELECT ON inventory_units,unit_status_history TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('005-inventory');
