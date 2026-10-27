BEGIN;
-- Preserve every evidence version; only one version of each kind is current.
ALTER TABLE booking_documents DROP CONSTRAINT booking_documents_company_id_booking_id_kind_key;
ALTER TABLE booking_documents DROP CONSTRAINT booking_documents_status_check;
ALTER TABLE booking_documents ADD CONSTRAINT booking_documents_status_check
 CHECK(status IN('ready','superseded','rejected','deleted'));
CREATE UNIQUE INDEX booking_documents_current_kind
 ON booking_documents(company_id,booking_id,kind) WHERE status='ready';
REVOKE DELETE,UPDATE ON booking_documents FROM bunyra_tenant;
GRANT UPDATE(status) ON booking_documents TO bunyra_tenant;

-- Use live company and project permissions, not a caller-supplied approval flag.
CREATE FUNCTION bunyra_booking_document_can(c uuid,p uuid,a text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $can$
 SELECT c IS NOT DISTINCT FROM bunyra_tenant_company() AND (
  EXISTS(SELECT 1 FROM platform_owner WHERE user_id=current_setting('app.user_id',true))
  OR EXISTS(
   SELECT 1 FROM memberships m LEFT JOIN custom_roles r ON r.company_id=m.company_id AND r.id=m.custom_role_id
   WHERE m.company_id=c AND m.user_id=current_setting('app.user_id',true) AND m.active
    AND NOT EXISTS(SELECT 1 FROM company_subscriptions WHERE company_id=c AND status='suspended')
    AND COALESCE((SELECT allowed FROM member_permissions WHERE company_id=c AND user_id=m.user_id AND project_id IS NULL AND action=a),
      CASE WHEN m.custom_role_id IS NOT NULL THEN (r.permissions->>a)::boolean
       ELSE m.role='company_admin' OR (a='bookings.create' AND m.role IN('sales','sales_manager'))
         OR (a='bookings.approve' AND m.role='operations') END,false)
    AND COALESCE((SELECT allowed FROM member_permissions WHERE company_id=c AND user_id=m.user_id AND project_id=p AND action=a),true)
  ))
$can$;
REVOKE ALL ON FUNCTION bunyra_booking_document_can(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_booking_document_can(uuid,uuid,text) TO bunyra_tenant;

CREATE FUNCTION bunyra_booking_document_revision_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $guard$
DECLARE booking_row bookings%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  -- The platform retention workflow remains the only deletion route.
  IF current_user<>'bunyra_tenant' AND EXISTS(SELECT 1 FROM companies
    WHERE id=OLD.company_id AND status='deleted' AND purged_at IS NOT NULL) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'DOCUMENT_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
   OR OLD.status<>'ready' OR NEW.status<>'superseded') THEN
  RAISE EXCEPTION 'DOCUMENT_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 SELECT * INTO booking_row FROM bookings WHERE company_id=NEW.company_id AND id=NEW.booking_id FOR UPDATE;
 IF NOT FOUND OR booking_row.status IN('cancelled','rejected') THEN
  RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE='P0001';
 END IF;
 IF NOT bunyra_booking_document_can(NEW.company_id,booking_row.project_id,'bookings.create')
   OR (booking_row.status<>'submitted' AND NOT bunyra_booking_document_can(NEW.company_id,booking_row.project_id,'bookings.approve')) THEN
  RAISE EXCEPTION 'DOCUMENT_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'ready' OR NEW.created_by IS DISTINCT FROM current_setting('app.user_id',true)) THEN
  RAISE EXCEPTION 'DOCUMENT_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION bunyra_booking_document_revision_guard() FROM PUBLIC;
CREATE TRIGGER booking_document_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_documents
 FOR EACH ROW EXECUTE FUNCTION bunyra_booking_document_revision_guard();
INSERT INTO schema_migrations(version) VALUES('071-booking-document-revisions');
COMMIT;
