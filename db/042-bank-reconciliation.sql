-- Bank statement ingestion and strict one-to-one reconciliation against posted bank GL lines.
-- No bank credentials, automatic imports or manual adjustment of posted GL journal lines.
BEGIN;
CREATE TABLE treasury_bank_statements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 bank_account_id uuid NOT NULL,
 statement_ref text NOT NULL CHECK(length(trim(statement_ref)) BETWEEN 2 AND 120),
 date_from date NOT NULL,
 date_to date NOT NULL,
 opening_minor bigint NOT NULL,
 closing_minor bigint NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','closed')),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 closed_by text,
 closed_at timestamptz,
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,bank_account_id,statement_ref),
 FOREIGN KEY(company_id,entity_id) REFERENCES ledger_entities(company_id,id),
 FOREIGN KEY(company_id,entity_id,bank_account_id) REFERENCES ledger_accounts(company_id,entity_id,id),
 CHECK(date_to>=date_from),
 CHECK((status='open' AND closed_at IS NULL AND closed_by IS NULL)
    OR (status='closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL))
);
CREATE TABLE treasury_bank_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 statement_id uuid NOT NULL,
 external_ref text NOT NULL CHECK(length(trim(external_ref)) BETWEEN 1 AND 180),
 booked_on date NOT NULL,
 signed_minor bigint NOT NULL CHECK(signed_minor<>0),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,id),
 UNIQUE(company_id,entity_id,statement_id,external_ref),
 FOREIGN KEY(company_id,entity_id,statement_id) REFERENCES treasury_bank_statements(company_id,entity_id,id)
);
CREATE TABLE treasury_bank_matches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 bank_line_id uuid NOT NULL,
 ledger_line_id uuid NOT NULL,
 matched_by text NOT NULL,
 matched_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,entity_id,bank_line_id),
 UNIQUE(ledger_line_id),
 FOREIGN KEY(company_id,entity_id,bank_line_id) REFERENCES treasury_bank_lines(company_id,entity_id,id),
 FOREIGN KEY(ledger_line_id) REFERENCES ledger_lines(id)
);
CREATE INDEX treasury_bank_by_period ON treasury_bank_statements(company_id,entity_id,date_to DESC);
CREATE INDEX treasury_bank_unmatched ON treasury_bank_lines(company_id,entity_id,statement_id,booked_on);

-- Keep a close operation serialized with new lines; closed statements cannot be amended.
CREATE FUNCTION bunyra_bank_line_open() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $
DECLARE stmt_status text;
BEGIN
 SELECT status INTO stmt_status FROM treasury_bank_statements
 WHERE company_id=NEW.company_id AND entity_id=NEW.entity_id AND id=NEW.statement_id FOR SHARE;
 IF stmt_status IS DISTINCT FROM 'open' THEN
  RAISE EXCEPTION 'TREASURY_STATEMENT_CLOSED' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $;
CREATE TRIGGER treasury_line_only_when_open BEFORE INSERT ON treasury_bank_lines
 FOR EACH ROW EXECUTE FUNCTION bunyra_bank_line_open();

CREATE FUNCTION bunyra_bank_match(p_company uuid,p_bank_line uuid,p_ledger_line uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row_data record; previous treasury_bank_matches%ROWTYPE; matching_account ledger_accounts%ROWTYPE;
       who text; posted text; line ledger_lines%ROWTYPE; result uuid;
BEGIN
 IF p_company IS DISTINCT FROM public.bunyra_tenant_company() THEN
  RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
 AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who
    AND active AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT bl.*,s.bank_account_id,s.status,s.date_from,s.date_to INTO row_data
  FROM treasury_bank_lines bl JOIN treasury_bank_statements s
   ON s.company_id=bl.company_id AND s.entity_id=bl.entity_id AND s.id=bl.statement_id
  WHERE bl.company_id=p_company AND bl.id=p_bank_line FOR UPDATE OF bl FOR SHARE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'TREASURY_LINE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF row_data.status<>'open' THEN RAISE EXCEPTION 'TREASURY_STATEMENT_CLOSED' USING ERRCODE='P0001'; END IF;
 SELECT * INTO previous FROM treasury_bank_matches
  WHERE company_id=p_company AND entity_id=row_data.entity_id AND bank_line_id=p_bank_line;
 IF FOUND THEN
  IF previous.ledger_line_id<>p_ledger_line THEN RAISE EXCEPTION 'TREASURY_ALREADY_MATCHED' USING ERRCODE='P0001'; END IF;
  RETURN previous.id;
 END IF;
 SELECT * INTO line FROM ledger_lines WHERE company_id=p_company
  AND entity_id=row_data.entity_id AND id=p_ledger_line;
 IF NOT FOUND OR line.account_id<>row_data.bank_account_id
  OR (line.debit_minor::numeric-line.credit_minor::numeric)<>row_data.signed_minor::numeric
 THEN RAISE EXCEPTION 'TREASURY_AMOUNT_MISMATCH' USING ERRCODE='P0001'; END IF;
 SELECT e.state INTO posted FROM ledger_entries e
  WHERE e.company_id=line.company_id AND e.entity_id=line.entity_id AND e.id=line.entry_id;
 IF posted<>'posted' THEN RAISE EXCEPTION 'TREASURY_NOT_POSTED' USING ERRCODE='P0001'; END IF;
 INSERT INTO treasury_bank_matches(company_id,entity_id,bank_line_id,ledger_line_id,matched_by)
 VALUES(p_company,row_data.entity_id,p_bank_line,p_ledger_line,who) RETURNING id INTO result;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(
  p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),
  'treasury.bank_reconciled',jsonb_build_object('bank_line_id',p_bank_line,'ledger_line_id',p_ledger_line));
 RETURN result;
END $$;
CREATE FUNCTION bunyra_close_bank_statement(p_company uuid,p_statement uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s treasury_bank_statements%ROWTYPE; unmatched_count int; total numeric;who text;
BEGIN
 IF p_company IS DISTINCT FROM public.bunyra_tenant_company() THEN
   RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 who:=current_setting('app.user_id',true);
 IF NOT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=who)
 AND NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=p_company AND user_id=who
  AND active AND role IN('company_admin','finance_manager'))
 THEN RAISE EXCEPTION 'LEDGER_FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM treasury_bank_statements WHERE company_id=p_company AND id=p_statement FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TREASURY_STATEMENT_NOT_FOUND' USING ERRCODE='P0001';END IF;
 IF s.status='closed' THEN RETURN s.id;END IF;
 SELECT count(*) FILTER (WHERE m.id IS NULL)::int,coalesce(sum(l.signed_minor::numeric),0)
 INTO unmatched_count,total FROM treasury_bank_lines l LEFT JOIN treasury_bank_matches m
  ON m.company_id=l.company_id AND m.entity_id=l.entity_id AND m.bank_line_id=l.id
 WHERE l.company_id=p_company AND l.entity_id=s.entity_id AND l.statement_id=s.id;
 IF unmatched_count>0 THEN RAISE EXCEPTION 'TREASURY_UNMATCHED' USING ERRCODE='P0001';END IF;
 IF s.opening_minor::numeric+total<>s.closing_minor::numeric
 THEN RAISE EXCEPTION 'TREASURY_BALANCE_MISMATCH' USING ERRCODE='P0001';END IF;
 UPDATE treasury_bank_statements SET status='closed',closed_by=who,closed_at=now()
 WHERE company_id=p_company AND id=s.id;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(
  p_company,who,COALESCE((SELECT email FROM platform_owner WHERE user_id=who),
  (SELECT email FROM memberships WHERE company_id=p_company AND user_id=who),''),
  'treasury.statement_closed',jsonb_build_object('statement_id',s.id,'closing_minor',s.closing_minor));
 RETURN s.id;
END $$;
REVOKE ALL ON FUNCTION bunyra_bank_match(uuid,uuid,uuid),bunyra_close_bank_statement(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_bank_match(uuid,uuid,uuid),bunyra_close_bank_statement(uuid,uuid) TO bunyra_tenant;

DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['treasury_bank_statements','treasury_bank_lines','treasury_bank_matches'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY treasury_scope ON public.%I TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()))',t);
  EXECUTE format('GRANT SELECT ON public.%I TO bunyra_tenant',t);
 END LOOP;
END $$;
GRANT INSERT ON treasury_bank_statements,treasury_bank_lines TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('042-bank-reconciliation');
COMMIT;
