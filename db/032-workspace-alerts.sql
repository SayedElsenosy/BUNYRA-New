BEGIN;
-- Read receipts for ACTIVE task alerts. Customer email delivery is handled separately.
-- Receipt ownership is enforced by DB RLS as well as the authorized API.
CREATE TABLE workspace_alert_reads(
 company_id uuid NOT NULL REFERENCES companies(id),
 user_id text NOT NULL CHECK(length(user_id) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN('follow_up','booking_approval','receipt_confirmation','installment')),
 source_id uuid NOT NULL,
 signature text NOT NULL CHECK(length(signature)=32),
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,user_id,kind,source_id)
);
CREATE INDEX workspace_alert_reads_user ON workspace_alert_reads(company_id,user_id,read_at DESC);
ALTER TABLE workspace_alert_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_alert_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_alert_reads_personal_scope ON workspace_alert_reads TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()) AND user_id=current_setting('app.user_id',true))
 WITH CHECK(company_id=(SELECT bunyra_tenant_company()) AND user_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE ON workspace_alert_reads TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('032-workspace-alerts');
COMMIT;
