BEGIN;
CREATE TABLE custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
  permissions jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(permissions)='object'),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id), UNIQUE(company_id,name)
);
ALTER TABLE memberships ADD COLUMN custom_role_id uuid;
ALTER TABLE memberships ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE memberships ADD CONSTRAINT membership_custom_role_company FOREIGN KEY(company_id,custom_role_id) REFERENCES custom_roles(company_id,id);
CREATE UNIQUE INDEX membership_company_email ON memberships(company_id,lower(email));
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  email text NOT NULL CHECK(email=lower(email)),
  role text NOT NULL CHECK(role IN('company_admin','operations','sales','sales_manager','sales_admin','finance_manager','accountant')),
  custom_role_id uuid,
  token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','revoked')),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  created_by text NOT NULL,
  accepted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,custom_role_id) REFERENCES custom_roles(company_id,id)
);
CREATE INDEX invitation_company_time ON invitations(company_id,created_at DESC);
CREATE UNIQUE INDEX invitation_pending_email ON invitations(company_id,email) WHERE status='pending';
CREATE TABLE member_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id text NOT NULL,
  project_id uuid,
  action text NOT NULL CHECK(action IN('company.read','company.write','projects.read','projects.write','inventory.read','inventory.write','leads.read','leads.write','bookings.read','bookings.create','bookings.approve','bookings.cancel','finance.read','finance.write','finance.approve','members.manage','roles.manage','audit.read','offers.create','contracts.write','commissions.write')),
  allowed boolean NOT NULL,
  FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id),
  FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),
  UNIQUE NULLS NOT DISTINCT(company_id,user_id,project_id,action)
);
CREATE FUNCTION bunyra_has_membership(target_company uuid, target_user text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$ SELECT EXISTS(SELECT 1 FROM public.memberships m JOIN public.companies c ON c.id=m.company_id WHERE m.company_id=target_company AND m.user_id=target_user AND m.active AND c.status='active') $$;
REVOKE ALL ON FUNCTION bunyra_has_membership(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_has_membership(uuid,text) TO bunyra_tenant;
ALTER POLICY company_scope ON companies USING(id::text=current_setting('app.company_id',true) AND bunyra_has_membership(id,current_setting('app.user_id',true)));
ALTER POLICY membership_scope ON memberships USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
ALTER POLICY project_scope ON projects USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE member_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY custom_role_scope ON custom_roles FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
CREATE POLICY invite_scope ON invitations FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
CREATE POLICY member_permission_scope ON member_permissions FOR SELECT TO bunyra_tenant USING(company_id::text=current_setting('app.company_id',true) AND bunyra_has_membership(company_id,current_setting('app.user_id',true)));
GRANT SELECT ON custom_roles,invitations,member_permissions TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('002-identity-permissions');
COMMIT;
