BEGIN;
CREATE TABLE company_settings(
 company_id uuid PRIMARY KEY REFERENCES companies(id),
 logo_url text NOT NULL DEFAULT '', currency text NOT NULL DEFAULT 'EGP' CHECK(currency ~ '^[A-Z]{3}$'),
 time_zone text NOT NULL DEFAULT 'Africa/Cairo', locale text NOT NULL DEFAULT 'ar' CHECK(locale IN('ar','en')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organization_nodes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 kind text NOT NULL CHECK(kind IN('branch','department','team','legal_entity','cost_center')),
 code text NOT NULL CHECK(length(code) BETWEEN 1 AND 40), name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
 name_en text NOT NULL DEFAULT '', parent_id uuid, manager_user_id text,
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 UNIQUE(company_id,id), UNIQUE(company_id,kind,code),
 FOREIGN KEY(company_id,parent_id) REFERENCES organization_nodes(company_id,id),
 FOREIGN KEY(company_id,manager_user_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX organization_company_kind ON organization_nodes(company_id,kind);
CREATE TABLE member_placements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), user_id text NOT NULL,
 node_id uuid NOT NULL, project_id uuid, active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id),
 FOREIGN KEY(company_id,node_id) REFERENCES organization_nodes(company_id,id),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),
 UNIQUE NULLS NOT DISTINCT(company_id,user_id,node_id,project_id)
);
CREATE INDEX placement_company_user ON member_placements(company_id,user_id);
CREATE FUNCTION bunyra_check_organization() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE expected text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.kind<>OLD.kind THEN RAISE EXCEPTION 'NODE_KIND_IMMUTABLE' USING ERRCODE='23514'; END IF;
 expected:=CASE NEW.kind WHEN 'department' THEN 'branch' WHEN 'team' THEN 'department' WHEN 'cost_center' THEN 'legal_entity' ELSE NULL END;
 IF NEW.parent_id IS NOT NULL AND (expected IS NULL OR NOT EXISTS(SELECT 1 FROM organization_nodes p WHERE p.company_id=NEW.company_id AND p.id=NEW.parent_id AND p.kind=expected AND (p.active OR NOT NEW.active))) THEN RAISE EXCEPTION 'INVALID_PARENT' USING ERRCODE='23514'; END IF;
 IF NEW.active AND NEW.manager_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=NEW.company_id AND m.user_id=NEW.manager_user_id AND m.active) THEN RAISE EXCEPTION 'INACTIVE_MANAGER' USING ERRCODE='23514'; END IF;
 IF NOT NEW.active AND (EXISTS(SELECT 1 FROM organization_nodes n WHERE n.company_id=NEW.company_id AND n.parent_id=NEW.id AND n.active) OR EXISTS(SELECT 1 FROM member_placements p WHERE p.company_id=NEW.company_id AND p.node_id=NEW.id AND p.active)) THEN RAISE EXCEPTION 'NODE_IN_USE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER organization_integrity BEFORE INSERT OR UPDATE ON organization_nodes FOR EACH ROW EXECUTE FUNCTION bunyra_check_organization();
CREATE FUNCTION bunyra_check_placement() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.active AND (NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=NEW.company_id AND m.user_id=NEW.user_id AND m.active) OR NOT EXISTS(SELECT 1 FROM organization_nodes n WHERE n.company_id=NEW.company_id AND n.id=NEW.node_id AND n.active)) THEN RAISE EXCEPTION 'INVALID_PLACEMENT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER placement_integrity BEFORE INSERT OR UPDATE ON member_placements FOR EACH ROW EXECUTE FUNCTION bunyra_check_placement();
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE member_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_placements FORCE ROW LEVEL SECURITY;
CREATE POLICY settings_scope ON company_settings FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
CREATE POLICY organization_scope ON organization_nodes FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
CREATE POLICY placement_scope ON member_placements FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
GRANT SELECT ON company_settings,organization_nodes,member_placements TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('003-company-organization');
COMMIT;
