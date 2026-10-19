BEGIN;
ALTER TABLE member_permissions DROP CONSTRAINT member_permissions_action_check;
ALTER TABLE member_permissions ADD CONSTRAINT member_permissions_action_check CHECK(action IN('company.read','company.write','projects.read','projects.write','plans.publish','inventory.read','inventory.write','pricing.read','pricing.write','pricing.approve','leads.read','leads.write','bookings.read','bookings.create','bookings.approve','bookings.cancel','finance.read','finance.write','finance.approve','members.manage','accounts.manage','roles.manage','audit.read','offers.create','contracts.write','commissions.write'));
CREATE FUNCTION bunyra_pricing_can(target_action text,target_company uuid,target_project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM platform_owner WHERE user_id=current_setting('app.user_id',true)) OR EXISTS(
 SELECT 1 FROM memberships m JOIN companies c ON c.id=m.company_id LEFT JOIN custom_roles r ON r.company_id=m.company_id AND r.id=m.custom_role_id
 WHERE m.company_id=target_company AND m.user_id=current_setting('app.user_id',true) AND m.active AND c.status='active' AND m.role IN('company_admin','operations')
 AND coalesce((SELECT allowed FROM member_permissions p WHERE p.company_id=m.company_id AND p.user_id=m.user_id AND p.project_id=target_project AND p.action=target_action),
 (SELECT allowed FROM member_permissions p WHERE p.company_id=m.company_id AND p.user_id=m.user_id AND p.project_id IS NULL AND p.action=target_action),
 CASE WHEN m.custom_role_id IS NOT NULL THEN (r.permissions->>target_action)::boolean ELSE m.role='company_admin' OR (m.role='operations' AND target_action='pricing.write') END,false))
$$;
REVOKE ALL ON FUNCTION bunyra_pricing_can(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_pricing_can(text,uuid,uuid) TO bunyra_tenant;
CREATE TABLE price_books(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,project_id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by text NOT NULL,approved_by text,approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id),UNIQUE(company_id,project_id,id),
 CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX price_books_project ON price_books(company_id,project_id,created_at DESC);
CREATE TABLE price_book_plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,project_id uuid NOT NULL,book_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,40}$'),name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
 down_payment_bps integer NOT NULL CHECK(down_payment_bps BETWEEN 0 AND 10000),installments integer NOT NULL CHECK(installments BETWEEN 0 AND 600),interval_months integer NOT NULL CHECK(interval_months BETWEEN 1 AND 12),adjustment_bps integer NOT NULL DEFAULT 0 CHECK(adjustment_bps BETWEEN -9999 AND 100000),
 CHECK((installments=0 AND down_payment_bps=10000) OR (installments>0 AND down_payment_bps<10000 AND installments*interval_months<=600)),
 FOREIGN KEY(company_id,project_id,book_id) REFERENCES price_books(company_id,project_id,id),UNIQUE(company_id,project_id,book_id,id),UNIQUE(book_id,code)
);
CREATE TABLE price_book_entries(
 company_id uuid NOT NULL,project_id uuid NOT NULL,book_id uuid NOT NULL,unit_id uuid NOT NULL,
 source_unit_version integer NOT NULL CHECK(source_unit_version>0),price_minor bigint NOT NULL CHECK(price_minor>0 AND price_minor<100000000000000),
 PRIMARY KEY(company_id,project_id,book_id,unit_id),
 FOREIGN KEY(company_id,project_id,book_id) REFERENCES price_books(company_id,project_id,id),
 FOREIGN KEY(company_id,project_id,unit_id) REFERENCES inventory_units(company_id,project_id,id)
);
CREATE TABLE price_book_entry_plans(
 company_id uuid NOT NULL,project_id uuid NOT NULL,book_id uuid NOT NULL,unit_id uuid NOT NULL,plan_id uuid NOT NULL,
 PRIMARY KEY(company_id,project_id,book_id,unit_id,plan_id),
 FOREIGN KEY(company_id,project_id,book_id,unit_id) REFERENCES price_book_entries(company_id,project_id,book_id,unit_id),
 FOREIGN KEY(company_id,project_id,book_id,plan_id) REFERENCES price_book_plans(company_id,project_id,book_id,id)
);
CREATE TABLE project_pricing(
 company_id uuid NOT NULL,project_id uuid NOT NULL,book_id uuid NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,project_id),FOREIGN KEY(company_id,project_id,book_id) REFERENCES price_books(company_id,project_id,id)
);
CREATE FUNCTION bunyra_pricing_assert(ok boolean,message text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message USING ERRCODE='P0001'; END IF; RETURN true; END $$;
REVOKE ALL ON FUNCTION bunyra_pricing_assert(boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_pricing_assert(boolean,text) TO bunyra_tenant;
CREATE FUNCTION bunyra_price_book_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id AND status='deleted' AND purged_at IS NOT NULL) THEN RETURN OLD; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NOT bunyra_pricing_can('pricing.write',NEW.company_id,NEW.project_id) THEN RAISE EXCEPTION 'PRICING_FORBIDDEN' USING ERRCODE='P0001'; END IF;
 ELSE
  IF OLD.status='approved' THEN RAISE EXCEPTION 'APPROVED_PRICE_BOOK_IMMUTABLE' USING ERRCODE='P0001'; END IF;
  IF TG_OP='UPDATE' AND NEW.status='approved' THEN
   IF NOT bunyra_pricing_can('pricing.approve',OLD.company_id,OLD.project_id) THEN RAISE EXCEPTION 'PRICING_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  ELSIF NOT bunyra_pricing_can('pricing.write',OLD.company_id,OLD.project_id) THEN RAISE EXCEPTION 'PRICING_FORBIDDEN' USING ERRCODE='P0001'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.company_id<>OLD.company_id OR NEW.project_id<>OLD.project_id OR NEW.id<>OLD.id OR NEW.currency<>OLD.currency) THEN RAISE EXCEPTION 'PRICING_SCOPE_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER price_book_guard BEFORE INSERT OR UPDATE OR DELETE ON price_books FOR EACH ROW EXECUTE FUNCTION bunyra_price_book_guard();
CREATE FUNCTION bunyra_price_child_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c uuid; p uuid; b uuid; state text;
BEGIN
 IF TG_OP='DELETE' THEN c=OLD.company_id;p=OLD.project_id;b=OLD.book_id; ELSE c=NEW.company_id;p=NEW.project_id;b=NEW.book_id; END IF;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM companies WHERE id=c AND status='deleted' AND purged_at IS NOT NULL) THEN RETURN OLD; END IF;
 SELECT status INTO state FROM price_books WHERE id=b AND company_id=c AND project_id=p FOR SHARE;
 IF state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'APPROVED_PRICE_BOOK_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF NOT bunyra_pricing_can('pricing.write',c,p) THEN RAISE EXCEPTION 'PRICING_FORBIDDEN' USING ERRCODE='P0001'; END IF;
 IF TG_OP='UPDATE' AND (NEW.company_id<>OLD.company_id OR NEW.project_id<>OLD.project_id OR NEW.book_id<>OLD.book_id) THEN RAISE EXCEPTION 'PRICING_SCOPE_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER price_plan_guard BEFORE INSERT OR UPDATE OR DELETE ON price_book_plans FOR EACH ROW EXECUTE FUNCTION bunyra_price_child_guard();
CREATE TRIGGER price_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON price_book_entries FOR EACH ROW EXECUTE FUNCTION bunyra_price_child_guard();
CREATE TRIGGER price_entry_plan_guard BEFORE INSERT OR UPDATE OR DELETE ON price_book_entry_plans FOR EACH ROW EXECUTE FUNCTION bunyra_price_child_guard();
CREATE FUNCTION bunyra_active_pricing_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT bunyra_pricing_can('pricing.approve',NEW.company_id,NEW.project_id) OR NOT EXISTS(SELECT 1 FROM price_books WHERE id=NEW.book_id AND company_id=NEW.company_id AND project_id=NEW.project_id AND status='approved') THEN RAISE EXCEPTION 'PRICING_FORBIDDEN' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER active_pricing_guard BEFORE INSERT OR UPDATE ON project_pricing FOR EACH ROW EXECUTE FUNCTION bunyra_active_pricing_guard();
ALTER TABLE price_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_books FORCE ROW LEVEL SECURITY;
CREATE POLICY pricing_book_scope ON price_books TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company()) AND (status='approved' OR bunyra_pricing_can('pricing.write',company_id,project_id) OR bunyra_pricing_can('pricing.approve',company_id,project_id))) WITH CHECK(company_id=(SELECT bunyra_tenant_company()) AND (bunyra_pricing_can('pricing.write',company_id,project_id) OR bunyra_pricing_can('pricing.approve',company_id,project_id)));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['price_book_plans','price_book_entries','price_book_entry_plans'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY pricing_child_scope ON %1$I TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company()) AND EXISTS(SELECT 1 FROM price_books b WHERE b.id=%1$I.book_id AND b.company_id=%1$I.company_id AND b.project_id=%1$I.project_id)) WITH CHECK(company_id=(SELECT bunyra_tenant_company()) AND bunyra_pricing_can(''pricing.write'',company_id,project_id))',t);
END LOOP; END $$;
ALTER TABLE project_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_pricing FORCE ROW LEVEL SECURITY;
CREATE POLICY active_pricing_scope ON project_pricing TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()) AND bunyra_pricing_can('pricing.approve',company_id,project_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON price_books,price_book_plans,price_book_entries,price_book_entry_plans,project_pricing TO bunyra_tenant;
REVOKE ALL ON FUNCTION bunyra_price_book_guard(),bunyra_price_child_guard(),bunyra_active_pricing_guard() FROM PUBLIC;
INSERT INTO schema_migrations(version) VALUES('015-approved-pricing');
COMMIT;
