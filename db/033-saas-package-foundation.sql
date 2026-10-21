BEGIN;
-- BUNYRA SaaS: product catalog and immutable-at-assignment company entitlement snapshots.
-- No demo prices or plans are created. Existing companies remain unchanged until assigned.
CREATE TABLE subscription_plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE CHECK(code ~ '^[a-z][a-z0-9_-]{2,39}$'),
 name_ar text NOT NULL CHECK(length(name_ar) BETWEEN 2 AND 120),
 name_en text NOT NULL CHECK(length(name_en) BETWEEN 2 AND 120),
 billing_period text NOT NULL CHECK(billing_period IN ('month','year')),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 price_minor bigint CHECK(price_minor IS NULL OR price_minor>=0),
 included_seats integer NOT NULL CHECK(included_seats BETWEEN 1 AND 10000),
 included_projects integer NOT NULL CHECK(included_projects BETWEEN 1 AND 10000),
 features jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(features)='object'),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE company_subscriptions(
 company_id uuid PRIMARY KEY REFERENCES companies(id),
 plan_id uuid NOT NULL REFERENCES subscription_plans(id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('trial','active','grace','suspended')),
 seat_limit integer NOT NULL CHECK(seat_limit BETWEEN 1 AND 10000),
 project_limit integer NOT NULL CHECK(project_limit BETWEEN 1 AND 10000),
 features jsonb NOT NULL CHECK(jsonb_typeof(features)='object'),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 billing_period text NOT NULL CHECK(billing_period IN ('month','year')),
 agreed_price_minor bigint CHECK(agreed_price_minor IS NULL OR agreed_price_minor>=0),
 starts_at timestamptz NOT NULL DEFAULT now(),
 ends_at timestamptz,
 version integer NOT NULL DEFAULT 1,
 configured_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at IS NULL OR ends_at>starts_at)
);
CREATE INDEX subscription_plans_active_idx ON subscription_plans(active,code);
CREATE INDEX company_subscriptions_plan_idx ON company_subscriptions(plan_id,status);

-- Only server-owner writes are allowed. Tenant users can read their own snapshot,
-- never change a plan or a limit through direct RLS access.
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_subscriptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON subscription_plans,company_subscriptions FROM PUBLIC,bunyra_tenant;
GRANT SELECT ON subscription_plans,company_subscriptions TO bunyra_tenant;
CREATE POLICY subscription_plan_read ON subscription_plans FOR SELECT TO bunyra_tenant USING(active);
CREATE POLICY company_subscription_read ON company_subscriptions FOR SELECT TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()));

-- Serialize project creation against plan changes on the same companies row.
CREATE FUNCTION bunyra_subscription_project_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cap integer; state text; existing integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.company_id=OLD.company_id THEN RETURN NEW; END IF;
 PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
 SELECT project_limit,status INTO cap,state FROM company_subscriptions WHERE company_id=NEW.company_id;
 IF cap IS NULL THEN RETURN NEW; END IF; -- legacy company, no assigned plan
 IF state='suspended' THEN RAISE EXCEPTION 'SUBSCRIPTION_SUSPENDED' USING ERRCODE='P0001'; END IF;
 SELECT count(*)::int INTO existing FROM projects WHERE company_id=NEW.company_id AND (TG_OP='INSERT' OR id<>NEW.id);
 IF existing>=cap THEN RAISE EXCEPTION 'PROJECT_LIMIT_REACHED' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_subscription_project_limit() FROM PUBLIC;
CREATE TRIGGER subscription_project_limit BEFORE INSERT OR UPDATE OF company_id ON projects
 FOR EACH ROW EXECUTE FUNCTION bunyra_subscription_project_limit();

-- Existing company.account_limit remains the single source of truth for seat
-- enforcement in bunyra_account_seats(); synchronize it transactionally.
CREATE FUNCTION bunyra_subscription_limits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE usage_projects integer;
BEGIN
 PERFORM 1 FROM companies WHERE id=NEW.company_id AND status<>'deleted' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMPANY_INACTIVE' USING ERRCODE='P0001'; END IF;
 SELECT count(*)::int INTO usage_projects FROM projects WHERE company_id=NEW.company_id;
 IF usage_projects>NEW.project_limit THEN
  RAISE EXCEPTION 'PROJECT_LIMIT_BELOW_USAGE' USING ERRCODE='P0001';
 END IF;
 UPDATE companies SET account_limit=NEW.seat_limit,version=version+1,updated_at=now()
 WHERE id=NEW.company_id AND account_limit IS DISTINCT FROM NEW.seat_limit;
 -- Existing company_account_limit_guard prevents a downgrade below active usage.
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_subscription_limits() FROM PUBLIC;
CREATE TRIGGER subscription_limit_guard BEFORE INSERT OR UPDATE OF seat_limit,project_limit
 ON company_subscriptions FOR EACH ROW EXECUTE FUNCTION bunyra_subscription_limits();

INSERT INTO schema_migrations(version) VALUES('033-saas-package-foundation');
COMMIT;
