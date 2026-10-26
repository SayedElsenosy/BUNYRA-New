BEGIN;

CREATE FUNCTION bunyra_adjustment_can(c uuid,p uuid,a text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $permission$
 SELECT c=bunyra_tenant_company() AND (
  EXISTS(SELECT 1 FROM platform_owner WHERE user_id=current_setting('app.user_id',true))
  OR EXISTS(SELECT 1 FROM memberships m
   LEFT JOIN custom_roles r ON r.company_id=m.company_id AND r.id=m.custom_role_id
   LEFT JOIN member_permissions co ON co.company_id=m.company_id AND co.user_id=m.user_id AND co.action=a AND co.project_id IS NULL
   LEFT JOIN member_permissions pr ON pr.company_id=m.company_id AND pr.user_id=m.user_id AND pr.action=a AND pr.project_id=p
   WHERE m.company_id=c AND m.user_id=current_setting('app.user_id',true) AND m.active
    AND m.role IN('company_admin','finance_manager','accountant')
    AND (a='finance.write' OR (a='finance.approve' AND m.role IN('company_admin','finance_manager')))
    AND NOT EXISTS(SELECT 1 FROM company_subscriptions WHERE company_id=c AND status='suspended')
    AND COALESCE(co.allowed,CASE WHEN m.custom_role_id IS NULL THEN true ELSE (r.permissions->>a)::boolean END,false)
    AND CASE WHEN m.role='accountant' THEN pr.allowed IS TRUE ELSE COALESCE(pr.allowed,true) END)
 )
$permission$;
REVOKE ALL ON FUNCTION bunyra_adjustment_can(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_adjustment_can(uuid,uuid,text) TO bunyra_tenant;

-- Existing historical rows are retained. Every new approval/execution must use
-- two independent people, including platform-owner initiated adjustments.
CREATE FUNCTION bunyra_adjustment_separation_of_duties() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $guard$
DECLARE who text:=NULLIF(current_setting('app.user_id',true),''); project uuid;
BEGIN
 IF current_user='bunyra_tenant' THEN
  SELECT project_id INTO project FROM contracts WHERE company_id=NEW.company_id AND id=NEW.contract_id;
  IF project IS NULL OR NOT bunyra_adjustment_can(NEW.company_id,project,
      CASE WHEN TG_OP='UPDATE' AND NEW.status='approved' AND OLD.status='requested' THEN 'finance.approve' ELSE 'finance.write' END) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'requested' OR NEW.approved_by IS NOT NULL OR NEW.executed_by IS NOT NULL
     OR NEW.approved_at IS NOT NULL OR NEW.executed_at IS NOT NULL THEN
   RAISE EXCEPTION 'ADJUSTMENT_INVALID_TRANSITION' USING ERRCODE='23514';
  END IF;
  IF current_user='bunyra_tenant' AND (who IS NULL OR NEW.created_by IS DISTINCT FROM who) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;

 IF ROW(NEW.id,NEW.company_id,NEW.contract_id,NEW.installment_id,NEW.collection_id,NEW.kind,
        NEW.amount_minor,NEW.reason,NEW.reference,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.contract_id,OLD.installment_id,OLD.collection_id,OLD.kind,
        OLD.amount_minor,OLD.reason,OLD.reference,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'ADJUSTMENT_TERMS_IMMUTABLE' USING ERRCODE='23514';
 END IF;

 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='approved' THEN
  IF OLD.status<>'requested' OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN
   RAISE EXCEPTION 'ADJUSTMENT_INVALID_TRANSITION' USING ERRCODE='23514';
  END IF;
  IF NEW.approved_by=OLD.created_by THEN
   RAISE EXCEPTION 'ADJUSTMENT_SELF_APPROVAL' USING ERRCODE='42501';
  END IF;
  IF current_user='bunyra_tenant' AND (who IS NULL OR NEW.approved_by IS DISTINCT FROM who) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
 ELSIF ROW(NEW.approved_by,NEW.approved_at) IS DISTINCT FROM ROW(OLD.approved_by,OLD.approved_at) THEN
  RAISE EXCEPTION 'ADJUSTMENT_TERMS_IMMUTABLE' USING ERRCODE='23514';
 END IF;

 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='executed' THEN
  IF OLD.status<>'approved' OR NEW.executed_by IS NULL OR NEW.executed_at IS NULL THEN
   RAISE EXCEPTION 'ADJUSTMENT_INVALID_TRANSITION' USING ERRCODE='23514';
  END IF;
  IF OLD.approved_by=OLD.created_by OR NEW.executed_by=OLD.approved_by THEN
   RAISE EXCEPTION 'ADJUSTMENT_INDEPENDENT_EXECUTOR' USING ERRCODE='42501';
  END IF;
  IF current_user='bunyra_tenant' AND (who IS NULL OR NEW.executed_by IS DISTINCT FROM who) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF current_user='bunyra_tenant' THEN
   -- Execution must also update the installment and write its audit atomically.
   RAISE EXCEPTION 'ADJUSTMENT_POSTING_REQUIRED' USING ERRCODE='42501';
  END IF;
 ELSIF NEW.executed_by IS DISTINCT FROM OLD.executed_by
    OR (NEW.executed_at IS DISTINCT FROM OLD.executed_at AND current_user='bunyra_tenant') THEN
  RAISE EXCEPTION 'ADJUSTMENT_TERMS_IMMUTABLE' USING ERRCODE='23514';
 END IF;

 IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status='requested' AND NEW.status IN('approved','rejected','voided'))
    OR (OLD.status='approved' AND NEW.status IN('executed','voided'))) THEN
  RAISE EXCEPTION 'ADJUSTMENT_INVALID_TRANSITION' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $guard$;

CREATE TRIGGER adjustment_separation_of_duties BEFORE INSERT OR UPDATE ON financial_adjustments
 FOR EACH ROW EXECUTE FUNCTION bunyra_adjustment_separation_of_duties();
REVOKE ALL ON FUNCTION bunyra_adjustment_separation_of_duties() FROM PUBLIC;

-- Only the checked definer wrapper can invoke the original posting operation.
-- A tenant-set GUC is intentionally not used as an execution capability.
ALTER FUNCTION bunyra_execute_adjustment(uuid,uuid,text,text)
 RENAME TO bunyra_execute_adjustment_internal;
REVOKE ALL ON FUNCTION bunyra_execute_adjustment_internal(uuid,uuid,text,text) FROM PUBLIC,bunyra_tenant;

CREATE FUNCTION bunyra_execute_adjustment(c uuid,a uuid,actor text,actor_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $execute$
DECLARE who text:=NULLIF(current_setting('app.user_id',true),'');
 contract_key uuid; project uuid; adj financial_adjustments%ROWTYPE;
BEGIN
 IF who IS NULL OR c IS NULL OR actor IS DISTINCT FROM who OR c IS DISTINCT FROM bunyra_tenant_company() THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 SELECT contract_id INTO contract_key FROM financial_adjustments WHERE company_id=c AND id=a;
 IF contract_key IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT project_id INTO project FROM contracts WHERE company_id=c AND id=contract_key;
 IF project IS NULL OR bunyra_adjustment_can(c,project,'finance.write') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 -- Match the posting function's contract -> adjustment -> installment lock order.
 PERFORM id FROM contracts WHERE company_id=c AND id=contract_key FOR UPDATE;
 SELECT * INTO adj FROM financial_adjustments WHERE company_id=c AND id=a FOR UPDATE;
 IF adj.status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
 IF adj.approved_by IS NULL OR adj.approved_by=adj.created_by OR adj.approved_by=who THEN
  RAISE EXCEPTION 'ADJUSTMENT_INDEPENDENT_EXECUTOR' USING ERRCODE='42501';
 END IF;
 RETURN public.bunyra_execute_adjustment_internal(c,a,who,actor_email);
END $execute$;
REVOKE ALL ON FUNCTION bunyra_execute_adjustment(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_execute_adjustment(uuid,uuid,text,text) TO bunyra_tenant;

INSERT INTO schema_migrations(version) VALUES('072-adjustment-separation-of-duties');
COMMIT;
