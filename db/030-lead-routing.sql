BEGIN;
-- Routing stays opt-in, tenant scoped, and never rewrites existing lead ownership.
CREATE TABLE crm_lead_routing_settings (
 company_id uuid PRIMARY KEY REFERENCES companies(id),
 team_id uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 next_index bigint NOT NULL DEFAULT 0 CHECK(next_index>=0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,team_id) REFERENCES crm_sales_teams(company_id,id)
);
ALTER TABLE crm_lead_routing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_routing_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_lead_routing_scope ON crm_lead_routing_settings TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()))
 WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT,UPDATE ON crm_lead_routing_settings TO bunyra_tenant;

-- Called from the same SQL statement that creates the lead, so failed inserts roll
-- back the cursor. The row lock serializes concurrent allocations.
-- SECURITY INVOKER means tenant RLS applies to all referenced relations.
CREATE FUNCTION bunyra_route_lead_owner(p_company uuid, p_project uuid, p_fallback text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
 v_team uuid;
 v_cursor bigint;
 v_members text[];
 v_count integer;
 v_result text;
BEGIN
 SELECT team_id,next_index INTO v_team,v_cursor
 FROM crm_lead_routing_settings
 WHERE company_id=p_company AND enabled FOR UPDATE;
 IF NOT FOUND THEN RETURN p_fallback; END IF;

 SELECT array_agg(m.user_id ORDER BY m.user_id) INTO v_members
 FROM crm_sales_team_members tm
 JOIN crm_sales_teams t ON t.company_id=tm.company_id AND t.id=tm.team_id AND t.active
 JOIN memberships m ON m.company_id=tm.company_id AND m.user_id=tm.user_id AND m.active
 LEFT JOIN custom_roles cr ON cr.company_id=m.company_id AND cr.id=m.custom_role_id
 WHERE tm.company_id=p_company AND tm.team_id=v_team
   AND m.role IN('sales','sales_manager')
   AND (
       COALESCE(
         (SELECT mp.allowed FROM member_permissions mp WHERE mp.company_id=p_company AND mp.user_id=m.user_id AND mp.project_id=p_project AND mp.action='leads.read'),
         (SELECT mp.allowed FROM member_permissions mp WHERE mp.company_id=p_company AND mp.user_id=m.user_id AND mp.project_id IS NULL AND mp.action='leads.read'),
         CASE WHEN m.custom_role_id IS NULL THEN true ELSE COALESCE((cr.permissions->>'leads.read')::boolean,false) END
       )
       AND COALESCE(
         (SELECT mp.allowed FROM member_permissions mp WHERE mp.company_id=p_company AND mp.user_id=m.user_id AND mp.project_id=p_project AND mp.action='leads.write'),
         (SELECT mp.allowed FROM member_permissions mp WHERE mp.company_id=p_company AND mp.user_id=m.user_id AND mp.project_id IS NULL AND mp.action='leads.write'),
         CASE WHEN m.custom_role_id IS NULL THEN true ELSE COALESCE((cr.permissions->>'leads.write')::boolean,false) END
       )
   );
 v_count:=COALESCE(array_length(v_members,1),0);
 IF v_count=0 THEN RAISE EXCEPTION 'ROUTING_NO_ELIGIBLE_MEMBERS' USING ERRCODE='P0001'; END IF;
 v_result:=v_members[(v_cursor % v_count)::integer+1];
 UPDATE crm_lead_routing_settings SET next_index=next_index+1,updated_at=now()
 WHERE company_id=p_company;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION bunyra_route_lead_owner(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_route_lead_owner(uuid,uuid,text) TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('030-lead-routing');
COMMIT;
