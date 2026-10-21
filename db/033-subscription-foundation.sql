BEGIN;
-- Optional subscriptions: no automatic assignment or retroactive limits for legacy companies.
-- All catalog/subscription writes remain platform-owner only (server role).
CREATE TABLE saas_plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE CHECK(code ~ '^[a-z][a-z0-9_-]{2,39}$'),
 name_ar text NOT NULL CHECK(length(name_ar) BETWEEN 2 AND 100),
 name_en text NOT NULL CHECK(length(name_en) BETWEEN 2 AND 100),
 active boolean NOT NULL DEFAULT true,
 currency text NOT NULL DEFAULT 'EGP' CHECK(currency ~ '^[A-Z]{3}$'),
 monthly_base_minor bigint NOT NULL CHECK(monthly_base_minor>=0),
 annual_base_minor bigint NOT NULL CHECK(annual_base_minor>=0),
 included_seats int NOT NULL CHECK(included_seats BETWEEN 1 AND 10000),
 monthly_extra_seat_minor bigint NOT NULL DEFAULT 0 CHECK(monthly_extra_seat_minor>=0),
 annual_extra_seat_minor bigint NOT NULL DEFAULT 0 CHECK(annual_extra_seat_minor>=0),
 max_projects int CHECK(max_projects IS NULL OR max_projects BETWEEN 1 AND 100000),
 max_units int CHECK(max_units IS NULL OR max_units BETWEEN 1 AND 10000000),
 features jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(features)='object'),
 version int NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE company_subscriptions(
 company_id uuid PRIMARY KEY REFERENCES companies(id),
 plan_id uuid NOT NULL REFERENCES saas_plans(id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','grace','billing_suspended','cancelled')),
 cycle text NOT NULL CHECK(cycle IN('monthly','annual')),
 included_seats int NOT NULL CHECK(included_seats BETWEEN 1 AND 10000),
 extra_seats int NOT NULL DEFAULT 0 CHECK(extra_seats BETWEEN 0 AND 9999),
 max_projects int CHECK(max_projects IS NULL OR max_projects BETWEEN 1 AND 100000),
 max_units int CHECK(max_units IS NULL OR max_units BETWEEN 1 AND 10000000),
 features jsonb NOT NULL CHECK(jsonb_typeof(features)='object'),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 base_price_minor bigint NOT NULL CHECK(base_price_minor>=0),
 extra_seat_price_minor bigint NOT NULL CHECK(extra_seat_price_minor>=0),
 started_at timestamptz NOT NULL DEFAULT now(),
 renews_at timestamptz,
 grace_until timestamptz,
 version int NOT NULL DEFAULT 1,
 changed_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(included_seats+extra_seats<=10000),
 CHECK(status<>'grace' OR grace_until IS NOT NULL)
);
ALTER TABLE saas_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_subscriptions FORCE ROW LEVEL SECURITY;
-- A company may only view its own entitlements; the catalog is exclusively owner-managed.
CREATE POLICY subscription_view ON company_subscriptions FOR SELECT TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT ON company_subscriptions TO bunyra_tenant;
REVOKE ALL ON saas_plans FROM PUBLIC,bunyra_tenant;
REVOKE INSERT,UPDATE,DELETE ON company_subscriptions FROM PUBLIC,bunyra_tenant;

-- Subscription assignment keeps the EXISTING seat system authoritative for
-- company account creation and legacy account-limit API.
CREATE FUNCTION bunyra_subscription_seat_sync() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE limit_new int; occupied int;
BEGIN
 limit_new:=NEW.included_seats+NEW.extra_seats;
 SELECT count(*)::int INTO occupied FROM memberships WHERE company_id=NEW.company_id AND active;
 occupied:=occupied+(SELECT count(*)::int FROM invitations i WHERE i.company_id=NEW.company_id
  AND i.status='pending' AND i.expires_at>now()
  AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=i.company_id AND m.active AND lower(m.email)=i.email));
 IF occupied>limit_new THEN RAISE EXCEPTION 'SUBSCRIPTION_SEATS_BELOW_USAGE' USING ERRCODE='P0001'; END IF;
 IF NEW.max_projects IS NOT NULL AND (SELECT count(*) FROM projects WHERE company_id=NEW.company_id)>NEW.max_projects
  THEN RAISE EXCEPTION 'SUBSCRIPTION_PROJECTS_BELOW_USAGE' USING ERRCODE='P0001'; END IF;
 IF NEW.max_units IS NOT NULL AND (SELECT count(*) FROM inventory_units WHERE company_id=NEW.company_id AND active)>NEW.max_units
  THEN RAISE EXCEPTION 'SUBSCRIPTION_UNITS_BELOW_USAGE' USING ERRCODE='P0001'; END IF;
 UPDATE companies SET account_limit=limit_new,updated_at=now() WHERE id=NEW.company_id;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_update_capacity AFTER INSERT OR UPDATE OF included_seats,extra_seats,max_projects,max_units
 ON company_subscriptions FOR EACH ROW EXECUTE FUNCTION bunyra_subscription_seat_sync();

CREATE OR REPLACE FUNCTION bunyra_account_seats() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cap integer;used integer;state text;
BEGIN
 IF NEW.active AND (TG_OP='INSERT' OR NOT OLD.active OR NEW.company_id<>OLD.company_id) THEN
  SELECT account_limit,status INTO cap,state FROM companies WHERE id=NEW.company_id FOR UPDATE;
  IF state<>'active' THEN RAISE EXCEPTION 'COMPANY_INACTIVE' USING ERRCODE='P0001'; END IF;
  SELECT count(*)::int INTO used FROM memberships WHERE company_id=NEW.company_id AND active AND user_id<>NEW.user_id;
  used:=used+(SELECT count(*)::int FROM invitations i
   WHERE i.company_id=NEW.company_id AND i.status='pending' AND i.expires_at>now()
     AND lower(i.email)<>lower(NEW.email)
     AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=i.company_id AND m.active AND lower(m.email)=i.email));
  IF used>=cap THEN RAISE EXCEPTION 'ACCOUNT_LIMIT_REACHED' USING ERRCODE='P0001'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.active AND NOT NEW.active THEN DELETE FROM app_sessions WHERE user_id=NEW.user_id; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION bunyra_invitation_seats() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cap int;used int;
BEGIN
 IF NEW.status='pending' AND NEW.expires_at>now()
    AND (TG_OP='INSERT' OR OLD.status<>'pending' OR OLD.email<>NEW.email OR OLD.company_id<>NEW.company_id OR OLD.expires_at<=now()) THEN
   SELECT account_limit INTO cap FROM companies WHERE id=NEW.company_id FOR UPDATE;
   -- Already-active members do not consume an additional invitation seat.
   IF NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND active AND lower(email)=NEW.email) THEN
    SELECT count(*)::int INTO used FROM memberships WHERE company_id=NEW.company_id AND active;
    used:=used+(SELECT count(*)::int FROM invitations i WHERE i.company_id=NEW.company_id AND i.id<>NEW.id
      AND i.status='pending' AND i.expires_at>now() AND NOT EXISTS(
      SELECT 1 FROM memberships m WHERE m.company_id=i.company_id AND m.active AND lower(m.email)=i.email));
    IF used>=cap THEN RAISE EXCEPTION 'ACCOUNT_LIMIT_REACHED' USING ERRCODE='P0001'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invitation_seats BEFORE INSERT OR UPDATE OF status,email,company_id,expires_at
 ON invitations FOR EACH ROW EXECUTE FUNCTION bunyra_invitation_seats();

CREATE OR REPLACE FUNCTION bunyra_account_limit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE occupied integer;subscribed integer;
BEGIN
 SELECT included_seats+extra_seats INTO subscribed FROM company_subscriptions WHERE company_id=NEW.id;
 IF subscribed IS NOT NULL AND NEW.account_limit<>subscribed THEN
  RAISE EXCEPTION 'SUBSCRIPTION_MANAGED_SEATS' USING ERRCODE='P0001';
 END IF;
 SELECT count(*)::int INTO occupied FROM memberships WHERE company_id=NEW.id AND active;
 occupied:=occupied+(SELECT count(*)::int FROM invitations i WHERE i.company_id=NEW.id
 AND i.status='pending' AND i.expires_at>now()
 AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=i.company_id AND m.active AND lower(m.email)=i.email));
 IF NEW.account_limit<occupied THEN RAISE EXCEPTION 'LIMIT_BELOW_USAGE' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION bunyra_limit_project_units() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE allowed_count int;current_count int;
BEGIN
 IF TG_TABLE_NAME='projects' THEN
  IF TG_OP='UPDATE' AND OLD.company_id=NEW.company_id THEN RETURN NEW; END IF;
  PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
  SELECT max_projects INTO allowed_count FROM company_subscriptions WHERE company_id=NEW.company_id;
  IF allowed_count IS NOT NULL THEN
   SELECT count(*) INTO current_count FROM projects WHERE company_id=NEW.company_id;
   IF current_count>=allowed_count THEN RAISE EXCEPTION 'PLAN_PROJECT_LIMIT_REACHED' USING ERRCODE='P0001'; END IF;
  END IF;
 ELSE
  IF NOT NEW.active OR (TG_OP='UPDATE' AND OLD.active AND OLD.company_id=NEW.company_id) THEN RETURN NEW; END IF;
  PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
  SELECT max_units INTO allowed_count FROM company_subscriptions WHERE company_id=NEW.company_id;
  IF allowed_count IS NOT NULL THEN
   SELECT count(*) INTO current_count FROM inventory_units WHERE company_id=NEW.company_id AND active AND id<>NEW.id;
   IF current_count>=allowed_count THEN RAISE EXCEPTION 'PLAN_UNIT_LIMIT_REACHED' USING ERRCODE='P0001'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER projects_subscription_quota BEFORE INSERT OR UPDATE OF company_id ON projects
 FOR EACH ROW EXECUTE FUNCTION bunyra_limit_project_units();
CREATE TRIGGER inventory_subscription_quota BEFORE INSERT OR UPDATE OF active,company_id ON inventory_units
 FOR EACH ROW EXECUTE FUNCTION bunyra_limit_project_units();

INSERT INTO schema_migrations(version) VALUES('033-subscription-foundation');
COMMIT;
