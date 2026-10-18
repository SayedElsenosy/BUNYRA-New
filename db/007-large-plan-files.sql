-- Expand the existing size check without changing any stored file or business data.
ALTER TABLE project_plan_files DROP CONSTRAINT project_plan_files_byte_size_check;
ALTER TABLE project_plan_files ADD CONSTRAINT project_plan_files_byte_size_check CHECK(byte_size BETWEEN 1 AND 104857600);
ALTER TABLE project_plan_files ADD COLUMN multipart_id text;
ALTER TABLE project_plan_files ADD COLUMN object_etag text;
ALTER TABLE project_plan_files ADD COLUMN upload_expires_at timestamptz;
INSERT INTO schema_migrations(version) VALUES('007-large-plan-files');
