BEGIN;
ALTER TABLE workspace_alert_reads DROP CONSTRAINT workspace_alert_reads_kind_check;
ALTER TABLE workspace_alert_reads ADD CONSTRAINT workspace_alert_reads_kind_check CHECK(kind IN('follow_up','booking_approval','receipt_confirmation','installment','lead_assignment'));
INSERT INTO schema_migrations(version) VALUES('036-fresh-lead-alerts');
COMMIT;
