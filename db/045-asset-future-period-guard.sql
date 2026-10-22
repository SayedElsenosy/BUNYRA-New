-- 045: Prevent recognition of depreciation in a future calendar month.
BEGIN;
CREATE FUNCTION bunyra_asset_future_period_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $assetfuture$
BEGIN
 IF NEW.source_type='asset' AND NEW.source_event LIKE 'depreciation_%'
 AND NEW.entry_date>date_trunc('month',current_timestamp AT TIME ZONE 'Africa/Cairo')::date
 THEN RAISE EXCEPTION 'ASSET_FUTURE_PERIOD' USING ERRCODE='P0001';END IF;
 RETURN NEW;
END $assetfuture$;
CREATE TRIGGER ledger_asset_no_future_depreciation BEFORE INSERT ON ledger_entries
 FOR EACH ROW EXECUTE FUNCTION bunyra_asset_future_period_guard();
INSERT INTO schema_migrations(version) VALUES('045-asset-future-period-guard');
COMMIT;
