-- Keep deletion work independently of business records so failed object deletion is retryable.
CREATE TABLE storage_cleanup_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 object_key text NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id, object_key)
);
CREATE INDEX storage_cleanup_pending ON storage_cleanup_jobs(company_id) WHERE completed_at IS NULL;
ALTER TABLE storage_cleanup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_cleanup_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON storage_cleanup_jobs FROM PUBLIC, bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('011-storage-cleanup');
