BEGIN;
-- Pending, unexpired invitations reserve a named seat until accepted, revoked or expired.
-- One reservation per invited email (the existing invitation_pending_email index enforces this).
CREATE OR REPLACE FUNCTION bunyra_account_seats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cap integer; used integer; pending integer; state text;
BEGIN
 IF NEW.active AND (TG_OP='INSERT' OR NOT OLD.active OR NEW.company_id<>OLD.company_id) THEN
  SELECT account_limit,status INTO cap,state FROM companies WHERE id=NEW.company_id FOR UPDATE;
  IF state<>'active' THEN RAISE EXCEPTION 'COMPANY_INACTIVE' USING ERRCODE='P0001'; END IF;
  SELECT count(*)::int INTO used FROM memberships m
   WHERE m.company_id=NEW.company_id AND m.active AND m.user_id<>NEW.user_id;
  SELECT count(*)::int INTO pending FROM invitations i
   WHERE i.company_id=NEW.company_id AND i.status='pending' AND i.expires_at>now()
   AND lower(i.email)<>lower(NEW.email)
   AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=i.company_id AND lower(m.email)=lower(i.email) AND m.active);
  IF used+pending>=cap THEN RAISE EXCEPTION 'ACCOUNT_LIMIT_REACHED' USING ERRCODE='P0001'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.active AND NOT NEW.active THEN
  DELETE FROM app_sessions WHERE user_id=NEW.user_id;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION bunyra_account_limit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE used integer; reserved integer;
BEGIN
 SELECT count(*)::int INTO used FROM memberships WHERE company_id=NEW.id AND active;
 SELECT count(*)::int INTO reserved FROM invitations i
  WHERE i.company_id=NEW.id AND i.status='pending' AND i.expires_at>now()
  AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=i.company_id AND lower(m.email)=lower(i.email) AND m.active);
 IF NEW.account_limit<used+reserved THEN RAISE EXCEPTION 'LIMIT_BELOW_USAGE' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION bunyra_invitation_seat_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cap integer; state text; used integer; reserved integer; already_active boolean;
BEGIN
 IF NEW.status='pending' AND NEW.expires_at>now() THEN
  SELECT account_limit,status INTO cap,state FROM companies WHERE id=NEW.company_id FOR UPDATE;
  IF state<>'active' THEN RAISE EXCEPTION 'COMPANY_INACTIVE' USING ERRCODE='P0001'; END IF;
  SELECT EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND lower(email)=lower(NEW.email) AND active) INTO already_active;
  IF NOT already_active THEN
   SELECT count(*)::int INTO used FROM memberships WHERE company_id=NEW.company_id AND active;
   SELECT count(*)::int INTO reserved FROM invitations i
    WHERE i.company_id=NEW.company_id AND i.status='pending' AND i.expires_at>now() AND i.id<>NEW.id
    AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=i.company_id AND lower(m.email)=lower(i.email) AND m.active);
   IF used+reserved>=cap THEN RAISE EXCEPTION 'ACCOUNT_LIMIT_REACHED' USING ERRCODE='P0001'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_invitation_seat_reservation() FROM PUBLIC;
CREATE TRIGGER invitation_seat_reservation BEFORE INSERT OR UPDATE OF status,expires_at,email,company_id ON invitations
 FOR EACH ROW EXECUTE FUNCTION bunyra_invitation_seat_reservation();

INSERT INTO schema_migrations(version) VALUES('034-pending-invitation-seat-reservations');
COMMIT;
