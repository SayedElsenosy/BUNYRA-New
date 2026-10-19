-- One transaction validates the complete preview before changing any unit.
-- SECURITY INVOKER retains the caller's tenant RLS and table permissions.
CREATE FUNCTION bunyra_sync_inventory(cid uuid,pid uuid,actor text,email text,digest text,source text,items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; old inventory_units%ROWTYPE; changed inventory_units%ROWTYPE;
 receipt inventory_imports%ROWTYPE; made integer:=0; edited integer:=0; same integer:=0;
BEGIN
 PERFORM id FROM projects WHERE company_id=cid AND id=pid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMPORT_CONFLICT'; END IF;
 SELECT * INTO receipt FROM inventory_imports WHERE company_id=cid AND project_id=pid AND payload_hash=digest;
 IF FOUND THEN RETURN jsonb_build_object('import_id',receipt.id,'already_imported',true); END IF;
 -- Lock all existing rows and validate every expected version before writing.
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  SELECT * INTO old FROM inventory_units WHERE company_id=cid AND project_id=pid AND lower(code)=lower(item->>'code') FOR UPDATE;
  IF FOUND THEN
   IF old.id::text IS DISTINCT FROM item->>'id' OR old.version IS DISTINCT FROM (item->>'expected_version')::integer THEN RAISE EXCEPTION 'IMPORT_CONFLICT'; END IF;
   IF item->>'kind'='update' AND (old.status NOT IN('available','unavailable') OR item->>'status' NOT IN('available','unavailable')) THEN RAISE EXCEPTION 'IMPORT_CONFLICT'; END IF;
  ELSIF item->>'id' IS NOT NULL OR item->>'kind'<>'create' THEN RAISE EXCEPTION 'IMPORT_CONFLICT';
  END IF;
 END LOOP;
 INSERT INTO inventory_imports(company_id,project_id,payload_hash,source_name,unit_count,actor_id)
 VALUES(cid,pid,digest,source,jsonb_array_length(items),actor) RETURNING * INTO receipt;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF item->>'kind'='unchanged' THEN same:=same+1; CONTINUE; END IF;
  IF item->>'kind'='create' THEN
   INSERT INTO inventory_units(company_id,project_id,code,building,floor,category,area,proposed_price_minor,status,active,details)
   VALUES(cid,pid,item->>'code',item->>'building',item->>'floor',item->>'category',(item->>'area')::numeric,(item->>'price')::bigint,item->>'status',(item->>'active')::boolean,item->'details') RETURNING * INTO changed;
   made:=made+1;
   INSERT INTO unit_status_history(company_id,project_id,unit_id,next_status,actor_id) VALUES(cid,pid,changed.id,changed.status,actor);
   INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(cid,actor,email,'inventory.created',to_jsonb(changed)||jsonb_build_object('import_id',receipt.id));
  ELSE
   SELECT * INTO old FROM inventory_units WHERE company_id=cid AND project_id=pid AND id=(item->>'id')::uuid;
   UPDATE inventory_units SET building=item->>'building',floor=item->>'floor',category=item->>'category',area=(item->>'area')::numeric,proposed_price_minor=(item->>'price')::bigint,status=item->>'status',active=(item->>'active')::boolean,details=item->'details',version=version+1,updated_at=now() WHERE company_id=cid AND project_id=pid AND id=old.id RETURNING * INTO changed;
   edited:=edited+1;
   IF old.status<>changed.status THEN INSERT INTO unit_status_history(company_id,project_id,unit_id,previous_status,next_status,actor_id) VALUES(cid,pid,changed.id,old.status,changed.status,actor); END IF;
   INSERT INTO audit_logs(company_id,actor_id,actor_email,action,before_data,after_data) VALUES(cid,actor,email,'inventory.updated',to_jsonb(old),to_jsonb(changed)||jsonb_build_object('import_id',receipt.id));
  END IF;
 END LOOP;
 INSERT INTO audit_logs(company_id,actor_id,actor_email,action,after_data) VALUES(cid,actor,email,'inventory.synced',jsonb_build_object('import_id',receipt.id,'source_name',source,'created',made,'updated',edited,'unchanged',same));
 RETURN jsonb_build_object('import_id',receipt.id,'already_imported',false,'created',made,'updated',edited,'unchanged',same);
END $$;
REVOKE ALL ON FUNCTION bunyra_sync_inventory(uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bunyra_sync_inventory(uuid,uuid,text,text,text,text,jsonb) TO bunyra_tenant;
INSERT INTO schema_migrations(version) VALUES('012-inventory-sync');
