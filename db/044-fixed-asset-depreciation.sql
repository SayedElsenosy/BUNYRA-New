-- 044: Fixed-asset register and monthly straight-line depreciation posting.
-- Asset acquisition value is historical register data; acquisition GL journal is posted separately.
BEGIN;
CREATE TABLE finance_fixed_assets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 project_id uuid,
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 2 AND 40),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 200),
 acquisition_date date NOT NULL,
 service_date date NOT NULL,
 cost_minor bigint NOT NULL CHECK(cost_minor>0),
 residual_minor bigint NOT NULL DEFAULT 0 CHECK(residual_minor>=0),
 useful_life_months integer NOT NULL CHECK(useful_life_months BETWEEN 1 AND 600),
 asset_account_id uuid NOT NULL,
 accumulated_account_id uuid NOT NULL,
 expense_account_id uuid NOT NULL,
 journal_id uuid NOT NULL,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,code),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),
 FOREIGN KEY(company_id,entity_id,asset_account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,accumulated_account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,expense_account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,journal_id) REFERENCES ledger_journals(company_id,entity_id,id),
 CHECK(service_date>=acquisition_date),
 CHECK(cost_minor-residual_minor>=useful_life_months),
 CHECK(asset_account_id<>accumulated_account_id AND asset_account_id<>expense_account_id AND accumulated_account_id<>expense_account_id)
);
CREATE TABLE finance_asset_depreciations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 asset_id uuid NOT NULL,
 period_month date NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 ledger_entry_id uuid NOT NULL,
 posted_by text NOT NULL,
 posted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,asset_id,period_month),
 UNIQUE(company_id,entity_id,ledger_entry_id),
 FOREIGN KEY(company_id,entity_id,asset_id) REFERENCES finance_fixed_assets(company_id,entity_id,id),
 FOREIGN KEY(company_id,entity_id,ledger_entry_id) REFERENCES ledger_entries(company_id,entity_id,id),
 CHECK(period_month=date_trunc('month',period_month)::date)
);
CREATE INDEX finance_asset_depreciations_by_asset ON finance_asset_depreciations(company_id,entity_id,asset_id,period_month);
CREATE FUNCTION bunyra_post_asset_depreciation(p_company uuid,p_asset uuid,p_month date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $assetdepr$
DECLARE a finance_fixed_assets%ROWTYPE; who text; existing uuid; idx integer; prior integer;
 base bigint; amount bigint; key text; hash_value text; created_entry uuid;
BEGIN
 IF p_company IS DISTINCT FROM bunyra_tenant_company()
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
  AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who
   AND active AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM finance_fixed_assets WHERE company_id=p_company AND id=p_asset FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ASSET_NOT_FOUND' USING ERRCODE='P0001';END IF;
 IF p_month IS NULL OR p_month IS DISTINCT FROM date_trunc('month',p_month)::date
 THEN RAISE EXCEPTION 'ASSET_INVALID_PERIOD' USING ERRCODE='P0001';END IF;
 SELECT ledger_entry_id INTO existing FROM finance_asset_depreciations
 WHERE company_id=p_company AND entity_id=a.entity_id AND asset_id=p_asset AND period_month=p_month;
 IF FOUND THEN RETURN existing;END IF;
 idx:=12*(EXTRACT(year FROM p_month)::int-EXTRACT(year FROM a.service_date)::int)
      +(EXTRACT(month FROM p_month)::int-EXTRACT(month FROM a.service_date)::int);
 IF idx<0 OR idx>=a.useful_life_months
 THEN RAISE EXCEPTION 'ASSET_PERIOD_OUTSIDE_LIFE' USING ERRCODE='P0001';END IF;
 SELECT count(*)::integer INTO prior FROM finance_asset_depreciations
 WHERE company_id=p_company AND entity_id=a.entity_id AND asset_id=p_asset;
 IF prior<>idx THEN RAISE EXCEPTION 'ASSET_DEPRECIATION_SEQUENCE' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_entities WHERE company_id=p_company AND id=a.entity_id AND active)
 OR NOT EXISTS(SELECT 1 FROM ledger_journals WHERE company_id=p_company AND entity_id=a.entity_id AND id=a.journal_id AND active)
 OR NOT EXISTS(SELECT 1 FROM ledger_accounts WHERE company_id=p_company AND entity_id=a.entity_id AND id=a.asset_account_id AND kind='asset' AND active AND allow_posting)
 OR NOT EXISTS(SELECT 1 FROM ledger_accounts WHERE company_id=p_company AND entity_id=a.entity_id AND id=a.accumulated_account_id AND kind='asset' AND active AND allow_posting)
 OR NOT EXISTS(SELECT 1 FROM ledger_accounts WHERE company_id=p_company AND entity_id=a.entity_id AND id=a.expense_account_id AND kind='expense' AND active AND allow_posting)
 THEN RAISE EXCEPTION 'ASSET_ACCOUNT_MAPPING_INVALID' USING ERRCODE='P0001';END IF;
 base:=a.cost_minor-a.residual_minor;
 amount:=base/a.useful_life_months+CASE WHEN idx<(base%a.useful_life_months) THEN 1 ELSE 0 END;
 key:='assetdep:'||a.id::text||':'||to_char(p_month,'YYYYMM');
 hash_value:=encode(sha256(convert_to(a.id::text||p_month::text||amount::text,'UTF8')),'hex');
 INSERT INTO ledger_entries(company_id,entity_id,journal_id,entry_date,reference,description,
  source_type,source_id,source_event,idempotency_key,payload_hash,created_by)
 VALUES(p_company,a.entity_id,a.journal_id,p_month,left('DEP:'||a.code||':'||to_char(p_month,'YYYY-MM'),200),
  left('Depreciation: '||a.name,1000),'asset',a.id,'depreciation_'||to_char(p_month,'YYYYMM'),key,hash_value,who)
 RETURNING id INTO created_entry;
 INSERT INTO ledger_lines(company_id,entity_id,entry_id,line_number,account_id,project_id,description,debit_minor,credit_minor)
 VALUES(p_company,a.entity_id,created_entry,1,a.expense_account_id,a.project_id,'Depreciation expense',amount,0),
       (p_company,a.entity_id,created_entry,2,a.accumulated_account_id,a.project_id,'Accumulated depreciation',0,amount);
 PERFORM bunyra_ledger_post_entry(p_company,created_entry);
 INSERT INTO finance_asset_depreciations(company_id,entity_id,asset_id,period_month,amount_minor,ledger_entry_id,posted_by)
 VALUES(p_company,a.entity_id,a.id,p_month,amount,created_entry,who);
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data)
 VALUES(p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),'finance.asset_depreciation_posted',
  jsonb_build_object('asset_id',a.id,'period_month',p_month,'amount_minor',amount,'entry_id',created_entry));
 RETURN created_entry;
END $assetdepr$;
REVOKE ALL ON FUNCTION bunyra_post_asset_depreciation(uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_post_asset_depreciation(uuid,uuid,date) TO bunyra_tenant;
DO $assetrls$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['finance_fixed_assets','finance_asset_depreciations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY tenant_scope ON public.%I TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()))',n);
  EXECUTE format('GRANT SELECT ON public.%I TO bunyra_tenant',n);
 END LOOP;
END $assetrls$;
GRANT INSERT ON finance_fixed_assets TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('044-fixed-asset-depreciation');
COMMIT;
