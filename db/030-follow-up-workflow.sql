BEGIN;
ALTER TABLE company_settings ADD COLUMN follow_up_escalation_hours integer NOT NULL DEFAULT 24 CHECK(follow_up_escalation_hours BETWEEN 1 AND 720);
ALTER TABLE crm_follow_ups
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN repeat_kind text NOT NULL DEFAULT 'none' CHECK(repeat_kind IN('none','daily','weekly','monthly')),
 ADD COLUMN repeat_every integer NOT NULL DEFAULT 1 CHECK(repeat_every BETWEEN 1 AND 12),
 ADD COLUMN predecessor_id uuid,
 ADD COLUMN defer_count integer NOT NULL DEFAULT 0 CHECK(defer_count>=0),
 ADD COLUMN last_defer_reason text NOT NULL DEFAULT '',
 ADD CONSTRAINT follow_up_company_identity UNIQUE(company_id,id),
 ADD CONSTRAINT follow_up_predecessor_scope FOREIGN KEY(company_id,predecessor_id) REFERENCES crm_follow_ups(company_id,id),
 ADD CONSTRAINT follow_up_one_successor UNIQUE(predecessor_id);
CREATE INDEX follow_up_assignee_due ON crm_follow_ups(company_id,assigned_to,status,due_at,id);
INSERT INTO schema_migrations(version)VALUES('030-follow-up-workflow');
COMMIT;
