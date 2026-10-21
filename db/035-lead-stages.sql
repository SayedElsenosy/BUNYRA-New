BEGIN;
ALTER TABLE crm_follow_ups ADD COLUMN lead_action boolean NOT NULL DEFAULT false;
ALTER TABLE crm_leads ADD COLUMN stage_code text;
ALTER TABLE crm_leads ADD COLUMN stage_changed_at timestamptz;
CREATE FUNCTION bunyra_stage_for_status(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE value WHEN 'new' THEN 'fresh' WHEN 'contacted' THEN 'follow_up' WHEN 'qualified' THEN 'interested' WHEN 'proposal' THEN 'reservation' WHEN 'won' THEN 'done_deal' WHEN 'lost' THEN 'not_interested' ELSE 'archive' END
$$;
UPDATE crm_leads SET stage_code=bunyra_stage_for_status(status);
-- Historical status does not give a reliable transition time. Keep it unknown
-- until the first tracked transition instead of inventing a duration.
ALTER TABLE crm_leads ALTER COLUMN stage_code SET NOT NULL;
ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_stage_code_check CHECK(stage_code IN('fresh','follow_up','not_interested','no_answer','interested','meeting','call_back','reschedule_meeting','outdoor','following_after_meeting','reservation','archive','done_deal','unreachable','cancellation'));
CREATE FUNCTION bunyra_sync_lead_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.stage_code:=COALESCE(NEW.stage_code,bunyra_stage_for_status(NEW.status));
  NEW.stage_changed_at:=now();
 ELSIF NEW.stage_code IS NOT DISTINCT FROM OLD.stage_code AND NEW.status IS DISTINCT FROM OLD.status THEN
  NEW.stage_code:=bunyra_stage_for_status(NEW.status);
 END IF;
 IF TG_OP='INSERT' OR NEW.stage_code IS DISTINCT FROM OLD.stage_code THEN
  NEW.status:=CASE NEW.stage_code WHEN 'fresh' THEN 'new' WHEN 'not_interested' THEN 'lost' WHEN 'cancellation' THEN 'lost' WHEN 'done_deal' THEN 'won' WHEN 'archive' THEN 'paused' WHEN 'reservation' THEN 'proposal' WHEN 'interested' THEN 'qualified' WHEN 'meeting' THEN 'qualified' WHEN 'outdoor' THEN 'qualified' WHEN 'reschedule_meeting' THEN 'qualified' WHEN 'following_after_meeting' THEN 'qualified' ELSE 'contacted' END;
  NEW.stage_changed_at:=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_leads_sync_stage BEFORE INSERT OR UPDATE ON crm_leads FOR EACH ROW EXECUTE FUNCTION bunyra_sync_lead_stage();
CREATE INDEX crm_leads_stage_time ON crm_leads(company_id,stage_code,stage_changed_at);
INSERT INTO schema_migrations(version) VALUES('035-lead-stages');
COMMIT;
