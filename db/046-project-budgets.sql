-- Project-level monthly expense budgets with immutable approved revisions.
-- This migration is additive; apply to isolated Neon development before production.
BEGIN;
CREATE TABLE finance_project_budgets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 project_id uuid NOT NULL,
 expense_account_id uuid NOT NULL,
 period_month date NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','superseded')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_by text,
 approved_at timestamptz,
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,project_id,expense_account_id,period_month,version),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),
 FOREIGN KEY(company_id,entity_id,expense_account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 CHECK(period_month=date_trunc('month',period_month)::date),
 CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL)
    OR (status IN('approved','superseded') AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX finance_budget_single_draft
 ON finance_project_budgets(company_id,entity_id,project_id,expense_account_id,period_month)
 WHERE status='draft';
CREATE UNIQUE INDEX finance_budget_single_approved
 ON finance_project_budgets(company_id,entity_id,project_id,expense_account_id,period_month)
 WHERE status='approved';
CREATE INDEX finance_budget_period_report
 ON finance_project_budgets(company_id,entity_id,period_month,project_id)
 WHERE status='approved';
CREATE FUNCTION bunyra_budget_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $budgetimmutable$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'BUDGET_DELETE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF to_jsonb(NEW)-'status'-'approved_by'-'approved_at'
    IS DISTINCT FROM to_jsonb(OLD)-'status'-'approved_by'-'approved_at'
 THEN RAISE EXCEPTION 'BUDGET_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NOT (
  (OLD.status='draft' AND NEW.status='approved' AND OLD.approved_by IS NULL
    AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL)
  OR (OLD.status='approved' AND NEW.status='superseded'
    AND NEW.approved_by=OLD.approved_by AND NEW.approved_at=OLD.approved_at)
 ) THEN RAISE EXCEPTION 'BUDGET_IMMUTABLE' USING ERRCODE='P0001';END IF;
 RETURN NEW;
END $budgetimmutable$;
CREATE TRIGGER finance_budget_guard BEFORE UPDATE OR DELETE ON finance_project_budgets
 FOR EACH ROW EXECUTE FUNCTION bunyra_budget_immutable();

CREATE FUNCTION bunyra_approve_project_budget(p_company uuid,p_budget uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $budgetapprove$
DECLARE b finance_project_budgets%ROWTYPE; who text;
BEGIN
 IF p_company IS DISTINCT FROM bunyra_tenant_company()
 THEN RAISE EXCEPTION 'BUDGET_FORBIDDEN' USING ERRCODE='42501';END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
  AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who
   AND active AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'BUDGET_FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM finance_project_budgets WHERE company_id=p_company AND id=p_budget FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUDGET_NOT_FOUND' USING ERRCODE='P0001';END IF;
 IF b.status='approved' THEN RETURN b.id; END IF;
 IF b.status<>'draft' THEN RAISE EXCEPTION 'BUDGET_NOT_DRAFT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  b.company_id::text||':'||b.entity_id::text||':'||b.project_id::text||':'||
  b.expense_account_id::text||':'||b.period_month::text,0));
 IF NOT EXISTS(SELECT 1 FROM ledger_accounts a WHERE a.company_id=b.company_id
  AND a.entity_id=b.entity_id AND a.id=b.expense_account_id AND a.kind='expense'
  AND a.active AND a.allow_posting)
 THEN RAISE EXCEPTION 'BUDGET_ACCOUNT_INVALID' USING ERRCODE='P0001';END IF;
 UPDATE finance_project_budgets SET status='superseded'
 WHERE company_id=b.company_id AND entity_id=b.entity_id AND project_id=b.project_id
  AND expense_account_id=b.expense_account_id AND period_month=b.period_month
  AND status='approved';
 UPDATE finance_project_budgets SET status='approved',approved_by=who,approved_at=now()
 WHERE company_id=p_company AND id=b.id;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),'finance.project_budget_approved',
  jsonb_build_object('budget_id',b.id,'project_id',b.project_id,'period_month',b.period_month,'version',b.version));
 RETURN b.id;
END $budgetapprove$;
REVOKE ALL ON FUNCTION bunyra_approve_project_budget(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_approve_project_budget(uuid,uuid) TO bunyra_tenant;
ALTER TABLE finance_project_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_project_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON finance_project_budgets TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()))
 WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT ON finance_project_budgets TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('046-project-budgets');
COMMIT;
