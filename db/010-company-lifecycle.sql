-- Request 4: company registration requests and safe, retained company deletion.
BEGIN;
ALTER TABLE companies DROP CONSTRAINT companies_status_check;
ALTER TABLE companies ADD CONSTRAINT companies_status_check CHECK(status IN('active','suspended','deleted'));
ALTER TABLE companies
 ADD COLUMN previous_status text CHECK(previous_status IN('active','suspended')),
 ADD COLUMN deleted_at timestamptz,
 ADD COLUMN deleted_by text,
 ADD COLUMN purge_after timestamptz,
 ADD COLUMN purged_at timestamptz,
 ADD CONSTRAINT companies_deletion_state CHECK((status='deleted')=(deleted_at IS NOT NULL AND purge_after IS NOT NULL));

-- A deleted company is closed to everyone, including the platform owner's company workspace.
CREATE OR REPLACE FUNCTION bunyra_tenant_company() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.id FROM public.companies c
 WHERE c.id=NULLIF(current_setting('app.company_id',true),'')::uuid
 AND (
  (c.status<>'deleted' AND EXISTS(SELECT 1 FROM public.platform_owner o WHERE o.user_id=current_setting('app.user_id',true)))
  OR (c.status='active' AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.company_id=c.id AND m.user_id=current_setting('app.user_id',true) AND m.active))
 )
$$;

CREATE TABLE company_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_name text NOT NULL CHECK(length(company_name) BETWEEN 2 AND 160),
 company_name_en text NOT NULL DEFAULT '' CHECK(length(company_name_en)<=160),
 contact_name text NOT NULL CHECK(length(contact_name) BETWEEN 2 AND 120),
 email text NOT NULL CHECK(email=lower(email) AND length(email) BETWEEN 3 AND 254),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40),
 message text NOT NULL DEFAULT '' CHECK(length(message)<=2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
 review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=1000),
 reviewed_by text, reviewed_at timestamptz,
 created_company_id uuid REFERENCES companies(id),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='pending')=(reviewed_at IS NULL)),
 CHECK((status='approved')=(created_company_id IS NOT NULL))
);
CREATE UNIQUE INDEX company_requests_one_pending ON company_requests(email) WHERE status='pending';
CREATE INDEX company_requests_status ON company_requests(status,created_at DESC);
ALTER TABLE company_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON company_requests FROM PUBLIC, bunyra_tenant;

INSERT INTO schema_migrations(version) VALUES('010-company-lifecycle');
COMMIT;
