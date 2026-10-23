-- Automatic authority must track live role, custom-role and permission revocation.
BEGIN;
CREATE FUNCTION bunyra_finance_user_authorized(p_company uuid,p_user text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $authorized$
 SELECT EXISTS(SELECT 1 FROM companies c WHERE c.id=p_company AND c.status='active' AND (
  EXISTS(SELECT 1 FROM platform_owner WHERE user_id=p_user)
  OR (NOT EXISTS(SELECT 1 FROM company_subscriptions WHERE company_id=p_company AND status='suspended')
   AND EXISTS(SELECT 1 FROM memberships m LEFT JOIN custom_roles r ON r.company_id=m.company_id AND r.id=m.custom_role_id
    WHERE m.company_id=p_company AND m.user_id=p_user AND m.active AND m.role IN('company_admin','finance_manager')
    AND COALESCE((SELECT allowed FROM member_permissions WHERE company_id=p_company AND user_id=p_user
     AND project_id IS NULL AND action='finance.approve' LIMIT 1),
     CASE WHEN m.custom_role_id IS NULL THEN true ELSE r.permissions @> '{"finance.approve":true}'::jsonb END,false)))))
$authorized$;
REVOKE ALL ON FUNCTION bunyra_finance_user_authorized(uuid,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION bunyra_require_finance_approver(p_company uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $authority$
DECLARE who text:=current_setting('app.user_id',true);
BEGIN
 IF p_company IS DISTINCT FROM bunyra_tenant_company() OR NOT bunyra_finance_user_authorized(p_company,who)
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN who;
END $authority$;
CREATE OR REPLACE FUNCTION bunyra_run_scheduled_finance_outbox()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $scheduled$
DECLARE cfg record; result jsonb; companies integer:=0; posted integer:=0; failed integer:=0;
 old_company text:=current_setting('app.company_id',true);old_user text:=current_setting('app.user_id',true);
 old_mode text:=current_setting('app.finance_scheduled',true);
BEGIN
 FOR cfg IN SELECT s.company_id,s.authorized_by FROM finance_automation_settings s JOIN companies c ON c.id=s.company_id
  WHERE s.enabled AND bunyra_finance_user_authorized(s.company_id,s.authorized_by)
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
CREATE OR REPLACE FUNCTION bunyra_attempt_finance_event(p_company uuid,p_event uuid)
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
  IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who) AND ev.project_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM member_permissions WHERE company_id=p_company AND user_id=who
    AND project_id=ev.project_id AND action='finance.approve' AND NOT allowed)
  THEN RAISE EXCEPTION 'FINANCE_PROJECT_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  entry:=bunyra_post_finance_event(p_company,ev.id);
  UPDATE finance_events SET processing_attempts=ev.processing_attempts+1,last_attempt_at=now(),last_error_code=NULL
   WHERE company_id=p_company AND id=ev.id;
  INSERT INTO finance_event_attempts(company_id,event_id,attempt_number,outcome,entry_id,automatic,actor_id)
  VALUES(p_company,ev.id,ev.processing_attempts+1,'posted',entry,automatic,who);
  RETURN jsonb_build_object('posted',1,'failed',0);
 EXCEPTION WHEN OTHERS THEN
  err:=CASE WHEN SQLERRM IN('FINANCE_PROJECT_FORBIDDEN','FINANCE_MAPPING_REQUIRED','FINANCE_MAPPING_INVALID','FINANCE_ENTITY_REQUIRED',
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
CREATE OR REPLACE FUNCTION bunyra_finance_event_autopost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $immediate$
DECLARE authorizer text; result jsonb;
 old_company text:=current_setting('app.company_id',true);old_user text:=current_setting('app.user_id',true);
 old_mode text:=current_setting('app.finance_automatic',true);
BEGIN
 IF NEW.status<>'pending' OR NEW.processing_kind='informational' THEN RETURN NEW; END IF;
 SELECT s.authorized_by INTO authorizer FROM finance_automation_settings s JOIN companies c ON c.id=s.company_id
 WHERE s.company_id=NEW.company_id AND s.enabled AND bunyra_finance_user_authorized(s.company_id,s.authorized_by);
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
 UPDATE finance_events SET processing_attempts=processing_attempts+1,last_attempt_at=now(),last_error_code='POSTING_FAILED',next_attempt_at=now()+interval '1 minute'
 WHERE company_id=NEW.company_id AND id=NEW.id;
 INSERT INTO finance_event_attempts(company_id,event_id,attempt_number,outcome,error_code,automatic,actor_id)
 SELECT company_id,id,processing_attempts,'failed','POSTING_FAILED',true,COALESCE(authorizer,'finance-automation')
 FROM finance_events WHERE company_id=NEW.company_id AND id=NEW.id;
 RETURN NEW;
END $immediate$;
REVOKE ALL ON FUNCTION bunyra_require_finance_approver(uuid),bunyra_run_scheduled_finance_outbox(),bunyra_attempt_finance_event(uuid,uuid),bunyra_finance_event_autopost() FROM PUBLIC;
INSERT INTO schema_migrations(version) VALUES('055-live-finance-authorization');
COMMIT;
