-- SELECT ... FOR SHARE requires UPDATE privilege on the statement table.
-- Tenant users deliberately cannot UPDATE statements: closing goes through the
-- protected, audited function. Elevate only the existing insert guard so it can
-- lock the parent; keep table INSERT RLS and all close/match checks unchanged.
BEGIN;
ALTER FUNCTION bunyra_bank_line_open() SECURITY DEFINER;
ALTER FUNCTION bunyra_bank_line_open() SET search_path=public,pg_temp;
REVOKE ALL ON FUNCTION bunyra_bank_line_open() FROM PUBLIC;
INSERT INTO schema_migrations(version) VALUES('049-treasury-import-lock-permission');
COMMIT;
