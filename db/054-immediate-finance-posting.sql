-- Immediate posting for opted-in companies; scheduled retries are a recovery path.
BEGIN;
CREATE FUNCTION bunyra_attempt_finance_event(p_company uuid,p_event uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $attempt$
DECLARE who text; ev finance_events%ROWTYPE; entry uuid; err text; automatic boolean;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 automatic:=COALESCE(current_setting('app.finance_scheduled',true)='1',false)
  OR COALESCE(current_setting('app.finance_automatic',true)='1',false);
 SELECT * INTO ev FROM finance_events WHERE company_id=p_company AND id=p_event FOR UPDATE;
 IF NOT FOUND OR ev.status<>'pending' OR ev.processing_attempts>=8 OR ev.next_attempt_at>now()
 THEN RETURN jsonb_build_object('posted',0,'failed',0); END IF;
 BEGIN
  entry:=bunyra_post_finance_event(p_company,ev.id);
  UPDATE finance_events SET processing_attempts=ev.processing_attempts+1,last_attempt_at=now(),last_error_code=NULL
   WHERE company_id=p_company AND id=ev.id;
  INSERT INTO finance_event_attempts(company_id,event_id,attempt_number,outcome,entry_id,automatic,actor_id)
  VALUES(p_company,ev.id,ev.processing_attempts+1,'posted',entry,automatic,who);
  RETURN jsonb_build_object('posted',1,'failed',0);
 EXCEPTION WHEN OTHERS THEN
  err:=CASE WHEN SQLERRM IN('FINANCE_MAPPING_REQUIRED','FINANCE_MAPPING_INVALID','FINANCE_ENTITY_REQUIRED',
   'LEDGER_PERIOD_LOCKED','LEDGER_ACCOUNT_INACTIVE','LEDGER_JOURNAL_INACTIVE','FINANCE_EVENT_NOT_POSTABLE',
   'LEDGER_CONTRACT_DIMENSION_MISMATCH','LEDGER_COST_CENTER_PROJECT_MISMATCH') THEN SQLERRM ELSE 'POSTING_FAILED' END;
  UPDATE finance_events SET processing_attempts=ev.processing_attempts+1,last_attempt_at=now(),last_error_code=err,
   next_attempt_at=now()+interval '1 minute'*least(60,power(2,least(ev.processing_attempts,6))::integer)
   WHERE company_id=p_company AND id=ev.id;
  INSERT INTO finance_event_attempts(company_id,event_id,attempt_number,outcome,error_code,automatic,actor_id)
  VALUES(p_company,ev.id,ev.processing_attempts+1,'failed',err,automatic,who);
  RETURN jsonb_build_object('posted',0,'failed',1);
 END;
END $attempt$;
REVOKE ALL ON FUNCTION bunyra_attempt_finance_event(uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION bunyra_process_finance_outbox(p_company uuid,p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $batch$
DECLARE who text; ev record; result jsonb; posted integer:=0; failed integer:=0;
BEGIN
 who:=bunyra_require_finance_approver(p_company);
 IF p_limit IS NULL OR p_limit<1 OR p_limit>50
 THEN RAISE EXCEPTION 'FINANCE_BATCH_INVALID' USING ERRCODE='P0001'; END IF;
 FOR ev IN SELECT id FROM finance_events WHERE company_id=p_company AND status='pending'
  AND processing_kind<>'informational' AND processing_attempts<8 AND next_attempt_at<=now()
  ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED
 LOOP
  result:=bunyra_attempt_finance_event(p_company,ev.id);
  posted:=posted+(result->>'posted')::integer;failed:=failed+(result->>'failed')::integer;
 END LOOP;
 IF posted+failed>0 THEN
  INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
  VALUES(p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
   (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),'finance.outbox_processed',
   jsonb_build_object('posted',posted,'failed',failed,'automatic',COALESCE(current_setting('app.finance_scheduled',true)='1',false)));
 END IF;
 RETURN jsonb_build_object('posted',posted,'failed',failed);
END $batch$;

CREATE FUNCTION bunyra_finance_event_autopost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $immediate$
DECLARE authorizer text; result jsonb;
 old_company text:=current_setting('app.company_id',true);old_user text:=current_setting('app.user_id',true);
 old_mode text:=current_setting('app.finance_automatic',true);
BEGIN
 IF NEW.status<>'pending' OR NEW.processing_kind='informational' THEN RETURN NEW; END IF;
 SELECT s.authorized_by INTO authorizer FROM finance_automation_settings s JOIN companies c ON c.id=s.company_id
 WHERE s.company_id=NEW.company_id AND s.enabled AND c.status='active' AND (
  EXISTS(SELECT 1 FROM platform_owner WHERE user_id=s.authorized_by)
  OR EXISTS(SELECT 1 FROM memberships WHERE company_id=s.company_id AND user_id=s.authorized_by
   AND active AND role IN('company_admin','finance_manager')));
 IF NOT FOUND THEN RETURN NEW; END IF;
 PERFORM set_config('app.company_id',NEW.company_id::text,true);
 PERFORM set_config('app.user_id',authorizer,true);
 PERFORM set_config('app.finance_automatic','1',true);
 result:=bunyra_attempt_finance_event(NEW.company_id,NEW.id);
 PERFORM set_config('app.company_id',COALESCE(old_company,''),true);
 PERFORM set_config('app.user_id',COALESCE(old_user,''),true);
 PERFORM set_config('app.finance_automatic',COALESCE(old_mode,''),true);
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 -- The source business event remains available for the durable recovery queue.
 PERFORM set_config('app.company_id',COALESCE(old_company,''),true);
 PERFORM set_config('app.user_id',COALESCE(old_user,''),true);
 PERFORM set_config('app.finance_automatic',COALESCE(old_mode,''),true);
 UPDATE finance_events SET last_error_code='POSTING_FAILED',next_attempt_at=now()+interval '1 minute'
 WHERE company_id=NEW.company_id AND id=NEW.id;
 RETURN NEW;
END $immediate$;
REVOKE ALL ON FUNCTION bunyra_finance_event_autopost() FROM PUBLIC;
CREATE TRIGGER finance_event_automatic_posting AFTER INSERT ON finance_events
 FOR EACH ROW EXECUTE FUNCTION bunyra_finance_event_autopost();
REVOKE ALL ON FUNCTION bunyra_process_finance_outbox(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_process_finance_outbox(uuid,integer) TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('054-immediate-finance-posting');
COMMIT;
