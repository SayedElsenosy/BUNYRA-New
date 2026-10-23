-- Bounded, opt-in finance posting with durable retries. Existing events remain pending.
BEGIN;
ALTER TABLE finance_events ADD COLUMN processing_attempts integer NOT NULL DEFAULT 0 CHECK(processing_attempts>=0);
ALTER TABLE finance_events ADD COLUMN last_attempt_at timestamptz;
ALTER TABLE finance_events ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE finance_events ADD COLUMN last_error_code text;
CREATE INDEX finance_events_due ON finance_events(company_id,next_attempt_at,created_at)
 WHERE status='pending' AND processing_attempts<8;
CREATE TABLE finance_automation_settings(
 company_id uuid PRIMARY KEY REFERENCES companies(id),
 enabled boolean NOT NULL DEFAULT false,
 authorized_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_run_at timestamptz,
 last_run_result jsonb
);
ALTER TABLE finance_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_automation_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON finance_automation_settings TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT ON finance_automation_settings TO bunyra_tenant;
CREATE TABLE finance_event_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,event_id uuid NOT NULL,
 attempt_number integer NOT NULL CHECK(attempt_number>0),outcome text NOT NULL CHECK(outcome IN('posted','failed')),
 error_code text,entry_id uuid,automatic boolean NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,event_id) REFERENCES finance_events(company_id,id),
 CHECK((outcome='posted' AND error_code IS NULL AND entry_id IS NOT NULL)
  OR(outcome='failed' AND error_code IS NOT NULL AND entry_id IS NULL))
);
ALTER TABLE finance_event_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_event_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON finance_event_attempts TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT ON finance_event_attempts TO bunyra_tenant;
CREATE INDEX finance_attempt_history ON finance_event_attempts(company_id,created_at DESC);
CREATE FUNCTION bunyra_finance_attempt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $immutable$
BEGIN RAISE EXCEPTION 'FINANCE_ATTEMPT_IMMUTABLE' USING ERRCODE='P0001';END $immutable$;
CREATE TRIGGER finance_attempt_immutable BEFORE UPDATE OR DELETE ON finance_event_attempts
 FOR EACH ROW EXECUTE FUNCTION bunyra_finance_attempt_immutable();

CREATE FUNCTION bunyra_configure_finance_automation(p_company uuid,p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $configure$
DECLARE who text; BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_INVALID' USING ERRCODE='P0001'; END IF;
 IF p_enabled AND NOT EXISTS(SELECT 1 FROM finance_account_mappings m JOIN ledger_entities e
  ON e.company_id=m.company_id AND e.id=m.entity_id AND e.is_default AND e.active WHERE m.company_id=p_company)
 THEN RAISE EXCEPTION 'FINANCE_MAPPING_REQUIRED' USING ERRCODE='P0001'; END IF;
 INSERT INTO finance_automation_settings(company_id,enabled,authorized_by)
 VALUES(p_company,p_enabled,who) ON CONFLICT(company_id) DO UPDATE
 SET enabled=EXCLUDED.enabled,authorized_by=EXCLUDED.authorized_by,updated_at=now();
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),'finance.automation_configured',
  jsonb_build_object('enabled',p_enabled,'scope','cash_and_customer_advances_only'));
 RETURN p_enabled;
END $configure$;

CREATE FUNCTION bunyra_process_finance_outbox(p_company uuid,p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $process$
DECLARE who text; ev record; posted integer:=0; failed integer:=0; entry uuid; err text;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_limit IS NULL OR p_limit<1 OR p_limit>50
 THEN RAISE EXCEPTION 'FINANCE_BATCH_INVALID' USING ERRCODE='P0001'; END IF;
 FOR ev IN SELECT id,processing_attempts FROM finance_events
  WHERE company_id=p_company AND status='pending' AND processing_kind<>'informational'
   AND processing_attempts<8 AND next_attempt_at<=now()
  ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED
 LOOP
  BEGIN
   entry:=bunyra_post_finance_event(p_company,ev.id);
   UPDATE finance_events SET processing_attempts=ev.processing_attempts+1,last_attempt_at=now(),last_error_code=NULL
   WHERE company_id=p_company AND id=ev.id;
   INSERT INTO finance_event_attempts(company_id,event_id,attempt_number,outcome,entry_id,automatic,actor_id)
   VALUES(p_company,ev.id,ev.processing_attempts+1,'posted',entry,
    COALESCE(current_setting('app.finance_scheduled',true)='1',false),who);
   posted:=posted+1;
  EXCEPTION WHEN OTHERS THEN
   -- Nested exception block rolls back the journal and posting audit atomically.
   err:=CASE WHEN SQLERRM IN('FINANCE_MAPPING_REQUIRED','FINANCE_MAPPING_INVALID','FINANCE_ENTITY_REQUIRED',
     'LEDGER_PERIOD_LOCKED','LEDGER_ACCOUNT_INACTIVE','LEDGER_JOURNAL_INACTIVE','FINANCE_EVENT_NOT_POSTABLE',
     'LEDGER_CONTRACT_DIMENSION_MISMATCH','LEDGER_COST_CENTER_PROJECT_MISMATCH') THEN SQLERRM ELSE 'POSTING_FAILED' END;
   UPDATE finance_events SET processing_attempts=ev.processing_attempts+1,last_attempt_at=now(),last_error_code=err,
    next_attempt_at=now()+interval '1 minute'*least(60,power(2,least(ev.processing_attempts,6))::integer)
   WHERE company_id=p_company AND id=ev.id;
   INSERT INTO finance_event_attempts(company_id,event_id,attempt_number,outcome,error_code,automatic,actor_id)
   VALUES(p_company,ev.id,ev.processing_attempts+1,'failed',err,
    COALESCE(current_setting('app.finance_scheduled',true)='1',false),who);
   failed:=failed+1;
  END;
 END LOOP;
 IF posted+failed>0 THEN
  INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
  VALUES(p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
   (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),'finance.outbox_processed',
   jsonb_build_object('posted',posted,'failed',failed,'automatic',current_setting('app.finance_scheduled',true)='1'));
 END IF;
 RETURN jsonb_build_object('posted',posted,'failed',failed);
END $process$;

CREATE FUNCTION bunyra_retry_finance_event(p_company uuid,p_event uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $retry$
DECLARE who text; ev finance_events%ROWTYPE; BEGIN
 who:=bunyra_require_finance_approver(p_company);
 SELECT * INTO ev FROM finance_events WHERE company_id=p_company AND id=p_event FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_EVENT_NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF ev.status<>'pending' OR ev.processing_attempts=0 OR ev.last_error_code IS NULL
 THEN RAISE EXCEPTION 'FINANCE_EVENT_NOT_RETRYABLE' USING ERRCODE='P0001'; END IF;
 UPDATE finance_events SET processing_attempts=0,next_attempt_at=now(),last_error_code=NULL
 WHERE company_id=p_company AND id=p_event;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),'finance.event_retry_requested',
  jsonb_build_object('event_id',p_event,'previous_attempts',ev.processing_attempts,'previous_error',ev.last_error_code));
 RETURN p_event;
END $retry$;

-- No tenant EXECUTE grant: invoked only by the trusted scheduled worker's server connection.
-- Authorization is revalidated each run; revoking the approver disables further posting.
CREATE FUNCTION bunyra_run_scheduled_finance_outbox()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $scheduled$
DECLARE cfg record; result jsonb; companies integer:=0; posted integer:=0; failed integer:=0;
 old_company text:=current_setting('app.company_id',true);old_user text:=current_setting('app.user_id',true);
 old_mode text:=current_setting('app.finance_scheduled',true);
BEGIN
 FOR cfg IN SELECT s.company_id,s.authorized_by FROM finance_automation_settings s JOIN companies c ON c.id=s.company_id
  WHERE s.enabled AND c.status='active' AND (
   EXISTS(SELECT 1 FROM platform_owner WHERE user_id=s.authorized_by)
   OR EXISTS(SELECT 1 FROM memberships WHERE company_id=s.company_id AND user_id=s.authorized_by
    AND active AND role IN('company_admin','finance_manager')))
  ORDER BY s.last_run_at NULLS FIRST,s.company_id LIMIT 20 FOR UPDATE OF s SKIP LOCKED
 LOOP
  PERFORM set_config('app.company_id',cfg.company_id::text,true);
  PERFORM set_config('app.user_id',cfg.authorized_by,true);
  PERFORM set_config('app.finance_scheduled','1',true);
  result:=bunyra_process_finance_outbox(cfg.company_id,10);
  UPDATE finance_automation_settings SET last_run_at=now(),last_run_result=result WHERE company_id=cfg.company_id;
  companies:=companies+1;posted:=posted+(result->>'posted')::integer;failed:=failed+(result->>'failed')::integer;
 END LOOP;
 PERFORM set_config('app.company_id',COALESCE(old_company,''),true);
 PERFORM set_config('app.user_id',COALESCE(old_user,''),true);
 PERFORM set_config('app.finance_scheduled',COALESCE(old_mode,''),true);
 RETURN jsonb_build_object('companies',companies,'posted',posted,'failed',failed);
END $scheduled$;
REVOKE ALL ON FUNCTION bunyra_configure_finance_automation(uuid,boolean),bunyra_process_finance_outbox(uuid,integer),
 bunyra_retry_finance_event(uuid,uuid),bunyra_run_scheduled_finance_outbox() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_configure_finance_automation(uuid,boolean),bunyra_process_finance_outbox(uuid,integer),
 bunyra_retry_finance_event(uuid,uuid) TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('051-finance-outbox');
COMMIT;
