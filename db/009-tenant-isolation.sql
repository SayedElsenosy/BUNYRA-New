BEGIN;
-- Resolves the company of the current request only when app.user_id is an
-- active member of an active company, or the platform owner.
CREATE FUNCTION bunyra_tenant_company() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.id FROM public.companies c
 WHERE c.id=NULLIF(current_setting('app.company_id',true),'')::uuid
 AND (EXISTS(SELECT 1 FROM public.platform_owner o WHERE o.user_id=current_setting('app.user_id',true))
  OR (c.status='active' AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.company_id=c.id AND m.user_id=current_setting('app.user_id',true) AND m.active)))
$$;
REVOKE ALL ON FUNCTION bunyra_tenant_company() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_tenant_company() TO bunyra_tenant;
DO $$
DECLARE t text; p record;
BEGIN
 FOR p IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' LOOP
  EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['company_settings','custom_roles','inventory_imports','inventory_units','invitations','member_permissions','member_placements','memberships','organization_nodes','plan_layouts','plan_unit_shapes','project_plan_files','project_setups','projects','unit_status_history'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON public.%I TO bunyra_tenant USING (company_id=(SELECT bunyra_tenant_company())) WITH CHECK (company_id=(SELECT bunyra_tenant_company()))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO bunyra_tenant',t);
 END LOOP;
END $$;
GRANT DELETE ON plan_unit_shapes TO bunyra_tenant;
CREATE POLICY tenant_isolation ON companies TO bunyra_tenant USING (id=(SELECT bunyra_tenant_company())) WITH CHECK (id=(SELECT bunyra_tenant_company()));
GRANT UPDATE(name,name_en,email,phone,address,version,updated_at) ON companies TO bunyra_tenant;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_audit_read ON audit_logs FOR SELECT TO bunyra_tenant USING (company_id=(SELECT bunyra_tenant_company()));
CREATE POLICY tenant_audit_write ON audit_logs FOR INSERT TO bunyra_tenant WITH CHECK (company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT ON audit_logs TO bunyra_tenant;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO bunyra_tenant;
CREATE FUNCTION bunyra_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AUDIT_IMMUTABLE' USING ERRCODE='42501'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION bunyra_audit_immutable();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION bunyra_audit_immutable();
REVOKE ALL ON platform_owner, schema_migrations FROM bunyra_tenant;
ALTER TABLE platform_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_owner FORCE ROW LEVEL SECURITY;
INSERT INTO schema_migrations(version) VALUES('009-tenant-isolation');
COMMIT;
