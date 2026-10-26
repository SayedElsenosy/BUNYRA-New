BEGIN;

-- Capture at commit, after createContract has inserted its original schedule.
-- Existing contracts are deliberately NOT backfilled from mutable present data.
CREATE TABLE contract_word_snapshots(
 company_id uuid NOT NULL,
 contract_id uuid NOT NULL,
 template_id uuid,
 template_object_key text,
 template_sha256 text,
 template_file_size integer,
 data_snapshot jsonb NOT NULL CHECK(jsonb_typeof(data_snapshot)='object'),
 captured_by text NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,contract_id),
 FOREIGN KEY(company_id,contract_id) REFERENCES contracts(company_id,id),
 FOREIGN KEY(company_id,template_id) REFERENCES contract_templates(company_id,id),
 CHECK((template_id IS NULL AND template_object_key IS NULL AND template_sha256 IS NULL AND template_file_size IS NULL)
    OR (template_id IS NOT NULL AND template_object_key IS NOT NULL
        AND template_sha256 IS NOT NULL AND template_file_size IS NOT NULL
        AND template_sha256 ~ '^[a-f0-9]{64}$' AND template_file_size BETWEEN 1 AND 5242880))
);
CREATE TABLE contract_word_files(
 company_id uuid NOT NULL,
 contract_id uuid NOT NULL,
 object_key text NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 file_size integer NOT NULL CHECK(file_size BETWEEN 1 AND 10485760),
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 200),
 generated_by text NOT NULL,
 generated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,contract_id),
 FOREIGN KEY(company_id,contract_id) REFERENCES contract_word_snapshots(company_id,contract_id)
);
ALTER TABLE contract_word_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_word_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE contract_word_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_word_files FORCE ROW LEVEL SECURITY;
CREATE POLICY contract_word_snapshots_company ON contract_word_snapshots TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()));
CREATE POLICY contract_word_files_company ON contract_word_files TO bunyra_tenant
 USING(company_id=(SELECT bunyra_tenant_company()))
 WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT ON contract_word_snapshots TO bunyra_tenant;
GRANT SELECT,INSERT ON contract_word_files TO bunyra_tenant;

-- Defense in depth for manifest publication. PostgreSQL cannot verify the bytes
-- in object storage: the trusted renderer still supplies their digest and size.
-- Do not let a direct tenant INSERT forge another actor, object path or reader.
CREATE FUNCTION bunyra_contract_word_reader(p_company uuid,p_contract uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who text:=current_setting('app.user_id',true); member_row record; doc record;
 company_permission boolean; project_permission boolean; baseline boolean;
BEGIN
 IF p_company IS DISTINCT FROM bunyra_tenant_company() THEN RETURN false; END IF;
 SELECT b.project_id,b.sales_user_id INTO doc FROM contracts c
 JOIN bookings b ON b.company_id=c.company_id AND b.id=c.booking_id
 WHERE c.company_id=p_company AND c.id=p_contract;
 IF NOT FOUND THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who) THEN
  RETURN EXISTS(SELECT 1 FROM companies WHERE id=p_company AND status<>'deleted');
 END IF;
 IF EXISTS(SELECT 1 FROM company_subscriptions WHERE company_id=p_company AND status='suspended')
 THEN RETURN false; END IF;
 SELECT m.role,m.custom_role_id,r.permissions INTO member_row FROM memberships m
 JOIN companies co ON co.id=m.company_id AND co.status='active'
 LEFT JOIN custom_roles r ON r.company_id=m.company_id AND r.id=m.custom_role_id
 WHERE m.company_id=p_company AND m.user_id=who AND m.active;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT allowed INTO company_permission FROM member_permissions
 WHERE company_id=p_company AND user_id=who AND project_id IS NULL AND action='bookings.read';
 SELECT allowed INTO project_permission FROM member_permissions
 WHERE company_id=p_company AND user_id=who AND project_id=doc.project_id AND action='bookings.read';
 baseline:=COALESCE(company_permission,CASE WHEN member_row.custom_role_id IS NOT NULL
  THEN COALESCE((member_row.permissions->>'bookings.read')::boolean,false)
  ELSE member_row.role IN('company_admin','operations','sales','sales_manager','finance_manager','accountant') END);
 -- access() requires company/module permission before evaluating record scope.
 IF NOT baseline THEN RETURN false; END IF;
 IF member_row.role='accountant' THEN
  IF project_permission IS DISTINCT FROM true THEN RETURN false; END IF;
 ELSIF COALESCE(project_permission,baseline) IS NOT TRUE THEN RETURN false;
 END IF;
 IF member_row.role='sales' THEN RETURN doc.sales_user_id=who; END IF;
 IF member_row.role='sales_manager' THEN
  RETURN doc.sales_user_id=who OR EXISTS(SELECT 1 FROM crm_sales_team_members tm
   JOIN crm_sales_teams t ON t.company_id=tm.company_id AND t.id=tm.team_id
   WHERE t.company_id=p_company AND t.active AND t.manager_user_id=who AND tm.user_id=doc.sales_user_id);
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION bunyra_contract_word_reader(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_contract_word_reader(uuid,uuid) TO bunyra_tenant;

CREATE FUNCTION bunyra_guard_contract_word_file() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE frozen jsonb;
BEGIN
 IF NEW.generated_by IS DISTINCT FROM current_setting('app.user_id',true)
 OR NOT bunyra_contract_word_reader(NEW.company_id,NEW.contract_id) THEN
  RAISE EXCEPTION 'CONTRACT_WORD_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF NEW.object_key !~ ('^'||NEW.company_id::text||'/contracts/issued/'||NEW.contract_id::text||
  '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.docx$') THEN
  RAISE EXCEPTION 'CONTRACT_WORD_OBJECT_INVALID' USING ERRCODE='23514';
 END IF;
 SELECT data_snapshot INTO frozen FROM contract_word_snapshots
 WHERE company_id=NEW.company_id AND contract_id=NEW.contract_id
  AND template_id IS NOT NULL AND template_object_key IS NOT NULL
  AND template_sha256 IS NOT NULL AND template_file_size IS NOT NULL;
 IF frozen IS NULL OR jsonb_typeof(frozen->'installments') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'CONTRACT_WORD_SNAPSHOT_INVALID' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(frozen->'installments')=0 OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(frozen->'installments') i
  WHERE jsonb_typeof(i) IS DISTINCT FROM 'object'
   OR COALESCE(i->>'number','') !~ '^[1-9][0-9]*$'
   OR COALESCE(i->>'amount_minor','') !~ '^[1-9][0-9]*$'
   OR COALESCE(i->>'paid_minor','') !~ '^[0-9]+$'
   OR COALESCE(i->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR COALESCE(i->>'status','') NOT IN('due','partial','paid','waived','overdue')
 ) THEN RAISE EXCEPTION 'CONTRACT_WORD_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
 NEW.generated_at:=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_guard_contract_word_file() FROM PUBLIC;
CREATE TRIGGER contract_word_file_publication BEFORE INSERT ON contract_word_files
 FOR EACH ROW EXECUTE FUNCTION bunyra_guard_contract_word_file();

CREATE FUNCTION bunyra_contract_word_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'CONTRACT_WORD_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER contract_word_snapshot_immutable BEFORE UPDATE OR DELETE ON contract_word_snapshots
 FOR EACH ROW EXECUTE FUNCTION bunyra_contract_word_immutable();
CREATE TRIGGER contract_word_file_immutable BEFORE UPDATE OR DELETE ON contract_word_files
 FOR EACH ROW EXECUTE FUNCTION bunyra_contract_word_immutable();

CREATE FUNCTION bunyra_capture_contract_word_snapshot() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE template_row record; frozen jsonb;
BEGIN
 SELECT t.id,f.object_key,f.sha256,f.file_size INTO template_row
 FROM contract_templates t JOIN contract_template_files f
  ON f.company_id=t.company_id AND f.template_id=t.id
 WHERE t.company_id=NEW.company_id AND t.active LIMIT 1;

 SELECT jsonb_build_object(
  'contract_number',NEW.contract_number,'status',NEW.status,
  'value_final_minor',NEW.value_final_minor::text,
  'signed_date',to_char(NEW.signed_at AT TIME ZONE COALESCE(s.time_zone,'Africa/Cairo'),'YYYY-MM-DD'),
  'currency',COALESCE(NEW.payment_plan_snapshot->'book'->>'currency','EGP'),
  'customer_name',b.customer_name,'customer_phone',b.customer_phone,
  'customer_email',b.customer_email,'correspondence_address',b.correspondence_address,
  'national_id',COALESCE(cr.national_id,''),'unit_code',u.code,'unit_area',u.area::text,
  'project_name',p.name,
  'installments',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'number',i.number,'due_date',i.due_date::text,'amount_minor',i.amount_minor::text,
    'paid_minor',i.paid_minor::text,'status',i.status) ORDER BY i.number,i.id)
   FROM contract_installments i WHERE i.company_id=NEW.company_id AND i.contract_id=NEW.id),'[]'::jsonb)
 ) INTO frozen
 FROM bookings b JOIN crm_customers cr ON cr.company_id=b.company_id AND cr.id=NEW.customer_id
 JOIN inventory_units u ON u.company_id=b.company_id AND u.id=NEW.unit_id
 JOIN projects p ON p.company_id=b.company_id AND p.id=NEW.project_id
 LEFT JOIN company_settings s ON s.company_id=b.company_id
 WHERE b.company_id=NEW.company_id AND b.id=NEW.booking_id;
 IF frozen IS NULL THEN
  RAISE EXCEPTION 'CONTRACT_WORD_SNAPSHOT_INVALID' USING ERRCODE='23514';
 END IF;
 INSERT INTO contract_word_snapshots(company_id,contract_id,template_id,template_object_key,
  template_sha256,template_file_size,data_snapshot,captured_by)
 VALUES(NEW.company_id,NEW.id,template_row.id,template_row.object_key,
  template_row.sha256,template_row.file_size,frozen,NEW.created_by);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bunyra_capture_contract_word_snapshot() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER contract_word_snapshot_at_commit AFTER INSERT ON contracts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bunyra_capture_contract_word_snapshot();

INSERT INTO schema_migrations(version) VALUES('073-contract-word-issuance');
COMMIT;
