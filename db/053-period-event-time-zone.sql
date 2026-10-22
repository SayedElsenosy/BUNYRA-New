-- Close checks use the same company-local event date as finance posting.
BEGIN;
CREATE OR REPLACE FUNCTION bunyra_lock_ledger_period(p_company uuid,p_entity uuid,p_start date,p_end date,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $ledgerlock$
DECLARE who text; result uuid;
BEGIN
 IF p_company IS DISTINCT FROM bunyra_tenant_company()
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
 AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who AND active
  AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF p_end<p_start OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
 THEN RAISE EXCEPTION 'LEDGER_INVALID_PERIOD' USING ERRCODE='P0001';END IF;
 PERFORM 1 FROM ledger_entities WHERE company_id=p_company AND id=p_entity AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_ENTITY_NOT_FOUND' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM ledger_period_locks WHERE company_id=p_company AND entity_id=p_entity
  AND daterange(date_from,date_to,'[]') && daterange(p_start,p_end,'[]'))
 THEN RAISE EXCEPTION 'LEDGER_PERIOD_OVERLAP' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM ledger_entries WHERE company_id=p_company AND entity_id=p_entity
  AND entry_date BETWEEN p_start AND p_end AND state<>'posted')
 THEN RAISE EXCEPTION 'LEDGER_PERIOD_DRAFTS' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM finance_events WHERE company_id=p_company
  AND (event_at AT TIME ZONE COALESCE((SELECT time_zone FROM company_settings WHERE company_id=p_company),'Africa/Cairo'))::date BETWEEN p_start AND p_end AND status='pending')
 THEN RAISE EXCEPTION 'LEDGER_PERIOD_PENDING_EVENTS' USING ERRCODE='P0001';END IF;
 INSERT INTO ledger_period_locks(company_id,entity_id,date_from,date_to,reason,locked_by)
 VALUES(p_company,p_entity,p_start,p_end,p_reason,who) RETURNING id INTO result;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(
  p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),
  'ledger.period_locked',jsonb_build_object('entity_id',p_entity,'date_from',p_start,'date_to',p_end,'lock_id',result));
 RETURN result;
END $ledgerlock$;

REVOKE ALL ON FUNCTION bunyra_lock_ledger_period(uuid,uuid,date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_lock_ledger_period(uuid,uuid,date,date,text) TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('053-period-event-time-zone');
COMMIT;
