BEGIN;
GRANT DELETE ON booking_documents TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('024-document-replacement-permission');
COMMIT;
