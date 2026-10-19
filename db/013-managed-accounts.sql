BEGIN;
ALTER TABLE companies ADD COLUMN account_limit integer NOT NULL DEFAULT 5 CHECK(account_limit BETWEEN 0 AND 10000);
UPDATE companies c SET account_limit=GREATEST(5,(SELECT count(*)::int FROM memberships m WHERE m.company_id=c.id AND m.active));
-- Credentials and sessions are server-only: tenant connections receive no grants.
CREATE TABLE app_accounts(
 user_id text PRIMARY KEY,
 company_id uuid REFERENCES companies(id),
 username text NOT NULL UNIQUE CHECK(username=lower(username) AND username ~ '^[a-z0-9_.@-]{3,100}$'),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 2 AND 120),
 email text NOT NULL DEFAULT '',
 password_hash text NOT NULL,
 must_change_password boolean NOT NULL DEFAULT true,
 password_version integer NOT NULL DEFAULT 1,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE app_sessions(
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
 user_id text NOT NULL REFERENCES app_accounts(user_id) ON DELETE CASCADE,
 password_version integer NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_sessions_user ON app_sessions(user_id);
CREATE INDEX app_sessions_expiry ON app_sessions(expires_at);
CREATE TABLE app_login_limits(bucket text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX app_login_limits_expiry ON app_login_limits(expires_at);
ALTER TABLE app_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE app_login_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_login_limits FORCE ROW LEVEL SECURITY;
CREATE FUNCTION bunyra_account_seats() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cap integer; used integer; state text;
BEGIN
 IF NEW.active AND (TG_OP='INSERT' OR NOT OLD.active OR NEW.company_id<>OLD.company_id) THEN
  SELECT account_limit,status INTO cap,state FROM companies WHERE id=NEW.company_id FOR UPDATE;
  IF state<>'active' THEN RAISE EXCEPTION 'COMPANY_INACTIVE' USING ERRCODE='P0001'; END IF;
  SELECT count(*)::int INTO used FROM memberships WHERE company_id=NEW.company_id AND active AND user_id<>NEW.user_id;
  IF used>=cap THEN RAISE EXCEPTION 'ACCOUNT_LIMIT_REACHED' USING ERRCODE='P0001'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.active AND NOT NEW.active THEN DELETE FROM app_sessions WHERE user_id=NEW.user_id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_account_seats() FROM PUBLIC;
CREATE TRIGGER membership_account_seats BEFORE INSERT OR UPDATE OF active,company_id ON memberships FOR EACH ROW EXECUTE FUNCTION bunyra_account_seats();
CREATE FUNCTION bunyra_account_limit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.account_limit<(SELECT count(*) FROM memberships WHERE company_id=NEW.id AND active) THEN RAISE EXCEPTION 'LIMIT_BELOW_USAGE' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_account_limit_guard() FROM PUBLIC;
CREATE TRIGGER company_account_limit_guard BEFORE UPDATE OF account_limit ON companies FOR EACH ROW EXECUTE FUNCTION bunyra_account_limit_guard();
-- Reactivating a company never revives sessions issued before its suspension.
CREATE FUNCTION bunyra_revoke_company_sessions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.status='active' AND NEW.status<>'active' THEN DELETE FROM app_sessions WHERE user_id IN(SELECT user_id FROM app_accounts WHERE company_id=NEW.id); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_revoke_company_sessions() FROM PUBLIC;
CREATE TRIGGER company_revoke_sessions AFTER UPDATE OF status ON companies FOR EACH ROW EXECUTE FUNCTION bunyra_revoke_company_sessions();
INSERT INTO schema_migrations(version) VALUES('013-managed-accounts');
COMMIT;
