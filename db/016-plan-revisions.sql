BEGIN;
CREATE FUNCTION bunyra_plan_can(target_action text,target_company uuid,target_project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=current_setting('app.user_id',true)) OR EXISTS(
 SELECT 1 FROM memberships m JOIN companies c ON c.id=m.company_id LEFT JOIN custom_roles r ON r.company_id=m.company_id AND r.id=m.custom_role_id
 WHERE m.company_id=target_company AND m.user_id=current_setting('app.user_id',true) AND m.active AND c.status='active' AND m.role IN('company_admin','operations') AND coalesce((SELECT allowed FROM member_permissions p WHERE p.company_id=m.company_id AND p.user_id=m.user_id AND p.project_id=target_project AND p.action=target_action),(SELECT allowed FROM member_permissions p WHERE p.company_id=m.company_id AND p.user_id=m.user_id AND p.project_id IS NULL AND p.action=target_action),CASE WHEN m.custom_role_id IS NOT NULL THEN (r.permissions->>target_action)::boolean ELSE m.role='company_admin' END,false))
$$;
REVOKE ALL ON FUNCTION bunyra_plan_can(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_plan_can(text,uuid,uuid) TO bunyra_tenant;
CREATE TABLE plan_layout_revisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,project_id uuid NOT NULL,file_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','approved')),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),shapes jsonb NOT NULL CHECK(jsonb_typeof(shapes)='array' AND jsonb_array_length(shapes)<=1000),unit_versions jsonb NOT NULL CHECK(jsonb_typeof(unit_versions)='object'),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),approved_by text,approved_at timestamptz,
 FOREIGN KEY(company_id,project_id,file_id) REFERENCES plan_layouts(company_id,project_id,file_id),UNIQUE(company_id,project_id,file_id,id),UNIQUE(file_id,version),
 CHECK((state='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (state='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE plan_layouts ADD COLUMN draft_revision_id uuid,ADD COLUMN published_revision_id uuid;
-- Preserve every existing mapping verbatim; no boundary correction or publication occurs here.
INSERT INTO plan_layout_revisions(company_id,project_id,file_id,version,state,reason,shapes,unit_versions,created_by,created_at,approved_by,approved_at)
 SELECT l.company_id,l.project_id,l.file_id,l.version,CASE WHEN l.published THEN 'approved' ELSE 'draft' END,'Existing mapping preserved during revision upgrade',coalesce((SELECT jsonb_agg(jsonb_build_object('unit_id',s.unit_id,'page',s.page,'points',s.points) ORDER BY s.page,s.unit_id) FROM plan_unit_shapes s WHERE s.file_id=l.file_id),'[]'::jsonb),coalesce((SELECT jsonb_object_agg(u.id::text,u.version) FROM inventory_units u JOIN plan_unit_shapes s ON s.unit_id=u.id AND s.company_id=u.company_id AND s.project_id=u.project_id WHERE s.file_id=l.file_id),'{}'::jsonb),l.updated_by,l.updated_at,CASE WHEN l.published THEN l.updated_by END,CASE WHEN l.published THEN l.updated_at END FROM plan_layouts l;
UPDATE plan_layouts l SET draft_revision_id=CASE WHEN NOT l.published THEN r.id END,published_revision_id=CASE WHEN l.published THEN r.id END FROM plan_layout_revisions r WHERE r.file_id=l.file_id;
ALTER TABLE plan_layouts ADD FOREIGN KEY(company_id,project_id,file_id,draft_revision_id) REFERENCES plan_layout_revisions(company_id,project_id,file_id,id) DEFERRABLE INITIALLY DEFERRED,ADD FOREIGN KEY(company_id,project_id,file_id,published_revision_id) REFERENCES plan_layout_revisions(company_id,project_id,file_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX plan_revision_scope ON plan_layout_revisions(company_id,project_id,file_id,version DESC);
ALTER TABLE plan_layout_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_layout_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_revision_scope ON plan_layout_revisions TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company()) AND (state='approved' OR bunyra_plan_can('projects.write',company_id,project_id) OR bunyra_plan_can('plans.publish',company_id,project_id))) WITH CHECK(company_id=(SELECT bunyra_tenant_company()) AND (bunyra_plan_can('projects.write',company_id,project_id) OR bunyra_plan_can('plans.publish',company_id,project_id)));
GRANT SELECT,INSERT,UPDATE ON plan_layout_revisions TO bunyra_tenant;
CREATE FUNCTION bunyra_plan_revision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id AND status='deleted' AND purged_at IS NOT NULL) THEN RETURN OLD;END IF;RAISE EXCEPTION 'LAYOUT_REVISION_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'draft' OR NOT bunyra_plan_can('projects.write',NEW.company_id,NEW.project_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001';END IF;
 ELSE
 IF OLD.state<>'draft' OR NEW.state<>'approved' OR (to_jsonb(NEW)-'state'-'approved_by'-'approved_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'approved_by'-'approved_at') THEN RAISE EXCEPTION 'LAYOUT_REVISION_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NOT bunyra_plan_can('plans.publish',NEW.company_id,NEW.project_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER plan_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON plan_layout_revisions FOR EACH ROW EXECUTE FUNCTION bunyra_plan_revision_guard();
CREATE FUNCTION bunyra_plan_pointer_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 IF TG_OP='INSERT' THEN IF NEW.published OR NEW.published_revision_id IS NOT NULL OR NOT bunyra_plan_can('projects.write',NEW.company_id,NEW.project_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001';END IF;
 ELSE
 IF (NEW.company_id,NEW.project_id,NEW.file_id) IS DISTINCT FROM (OLD.company_id,OLD.project_id,OLD.file_id) THEN RAISE EXCEPTION 'LAYOUT_REVISION_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NEW.published IS DISTINCT FROM OLD.published OR NEW.published_revision_id IS DISTINCT FROM OLD.published_revision_id THEN
 IF NOT bunyra_plan_can('plans.publish',NEW.company_id,NEW.project_id) OR NOT NEW.published OR NOT EXISTS(SELECT 1 FROM plan_layout_revisions r WHERE r.id=NEW.published_revision_id AND r.file_id=NEW.file_id AND r.company_id=NEW.company_id AND r.project_id=NEW.project_id AND r.state='approved') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001';END IF;
 END IF;
 IF NEW.draft_revision_id IS DISTINCT FROM OLD.draft_revision_id AND NEW.draft_revision_id IS NOT NULL AND NOT bunyra_plan_can('projects.write',NEW.company_id,NEW.project_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER plan_pointer_guard BEFORE INSERT OR UPDATE ON plan_layouts FOR EACH ROW EXECUTE FUNCTION bunyra_plan_pointer_guard();
CREATE FUNCTION bunyra_plan_cache_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ DECLARE c uuid;p uuid;BEGIN
 IF TG_OP='DELETE' THEN c=OLD.company_id;p=OLD.project_id;IF EXISTS(SELECT 1 FROM companies WHERE id=c AND status='deleted' AND purged_at IS NOT NULL) THEN RETURN OLD;END IF;ELSE c=NEW.company_id;p=NEW.project_id;END IF;
 IF NOT bunyra_plan_can('plans.publish',c,p) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END $$;
CREATE TRIGGER plan_cache_guard BEFORE INSERT OR UPDATE OR DELETE ON plan_unit_shapes FOR EACH ROW EXECUTE FUNCTION bunyra_plan_cache_guard();
DROP POLICY tenant_isolation ON plan_unit_shapes;
CREATE POLICY plan_cache_scope ON plan_unit_shapes TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company()) AND (EXISTS(SELECT 1 FROM plan_layouts l WHERE l.file_id=plan_unit_shapes.file_id AND l.company_id=plan_unit_shapes.company_id AND l.published) OR bunyra_plan_can('projects.write',company_id,project_id) OR bunyra_plan_can('plans.publish',company_id,project_id))) WITH CHECK(company_id=(SELECT bunyra_tenant_company()) AND bunyra_plan_can('plans.publish',company_id,project_id));
REVOKE ALL ON FUNCTION bunyra_plan_revision_guard(),bunyra_plan_pointer_guard(),bunyra_plan_cache_guard() FROM PUBLIC;
INSERT INTO schema_migrations(version) VALUES('016-plan-revisions');
COMMIT;
