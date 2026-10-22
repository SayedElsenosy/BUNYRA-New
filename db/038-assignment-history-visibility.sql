BEGIN;
ALTER TABLE crm_lead_transfers ADD COLUMN hide_previous_history boolean NOT NULL DEFAULT false;

-- The latest handoff controls only its current recipient. Supervisors keep the
-- original history; no business activity is deleted or rewritten.
CREATE FUNCTION bunyra_crm_history_start(p_company uuid,p_lead uuid,p_customer uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT max(h.created_at) FROM public.crm_leads l
 JOIN LATERAL (
  SELECT t.created_at,t.to_user_id,t.hide_previous_history FROM public.crm_lead_transfers t
  WHERE t.company_id=l.company_id AND t.lead_id=l.id ORDER BY t.created_at DESC,t.id DESC LIMIT 1
 ) h ON h.to_user_id=l.owner_user_id AND h.hide_previous_history
 WHERE l.company_id=p_company AND p_company=public.bunyra_tenant_company()
 AND l.owner_user_id=current_setting('app.user_id',true)
 AND ((p_lead IS NOT NULL AND l.id=p_lead) OR (p_lead IS NULL AND l.customer_id=p_customer))
 AND NOT EXISTS(SELECT 1 FROM public.platform_owner o WHERE o.user_id=current_setting('app.user_id',true))
 AND NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.company_id=p_company
  AND m.user_id=current_setting('app.user_id',true) AND m.active
  AND m.role IN('company_admin','sales_manager','sales_admin','operations'))
$$;
REVOKE ALL ON FUNCTION bunyra_crm_history_start(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_crm_history_start(uuid,uuid,uuid) TO bunyra_tenant;

CREATE POLICY crm_interaction_handoff_history ON crm_interactions AS RESTRICTIVE FOR SELECT TO bunyra_tenant
 USING(created_at>=COALESCE(bunyra_crm_history_start(company_id,lead_id,customer_id),'-infinity'::timestamptz));
CREATE POLICY crm_followup_handoff_history ON crm_follow_ups AS RESTRICTIVE FOR SELECT TO bunyra_tenant
 USING(created_at>=COALESCE(bunyra_crm_history_start(company_id,lead_id,customer_id),'-infinity'::timestamptz));
CREATE POLICY crm_transfer_handoff_history ON crm_lead_transfers AS RESTRICTIVE FOR SELECT TO bunyra_tenant
 USING(created_at>=COALESCE(bunyra_crm_history_start(company_id,lead_id,NULL),'-infinity'::timestamptz));

CREATE FUNCTION bunyra_crm_audit_visible(p_company uuid,p_record text,p_lead text,p_customer text,p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_at>=COALESCE(public.bunyra_crm_history_start(p_company,
  (SELECT l.id FROM public.crm_leads l WHERE l.company_id=p_company AND l.id::text=COALESCE(p_lead,p_record) LIMIT 1),
  COALESCE((SELECT c.id FROM public.crm_customers c WHERE c.company_id=p_company AND c.id::text=p_customer LIMIT 1),
   (SELECT f.customer_id FROM public.crm_follow_ups f WHERE f.company_id=p_company AND f.id::text=p_record LIMIT 1))
 ),'-infinity'::timestamptz)
$$;
REVOKE ALL ON FUNCTION bunyra_crm_audit_visible(uuid,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_crm_audit_visible(uuid,text,text,text,timestamptz) TO bunyra_tenant;
CREATE POLICY crm_audit_handoff_history ON audit_logs AS RESTRICTIVE FOR SELECT TO bunyra_tenant
 USING(action NOT LIKE 'crm.%' OR bunyra_crm_audit_visible(company_id,
  COALESCE(after_data->>'id',before_data->>'id'),COALESCE(after_data->>'lead_id',before_data->>'lead_id'),
  COALESCE(after_data->>'customer_id',before_data->>'customer_id'),created_at));
INSERT INTO schema_migrations(version) VALUES('038-assignment-history-visibility');
COMMIT;
