BEGIN;
ALTER TABLE ledger_lines DROP CONSTRAINT ledger_currency_snapshot_balance;
ALTER TABLE ledger_lines ADD CONSTRAINT ledger_currency_snapshot_balance CHECK(
 (amount_currency_minor IS NULL AND exchange_rate IS NULL AND currency_code='EGP') OR
 (amount_currency_minor IS NOT NULL AND exchange_rate IS NOT NULL AND exchange_rate>0
  AND currency_code IN('EGP','USD','EUR','GBP','SAR','AED','QAR','CHF','CAD','AUD','CNY')
  AND (currency_code<>'EGP' OR exchange_rate=1)
  AND abs(round(abs(amount_currency_minor)::numeric*exchange_rate)-greatest(debit_minor,credit_minor))<=CASE WHEN currency_code='EGP' THEN 0 ELSE 1 END
  AND ((amount_currency_minor>0 AND debit_minor>0) OR (amount_currency_minor<0 AND credit_minor>0))));
INSERT INTO schema_migrations(version) VALUES('059-currency-snapshot-null-guard');
COMMIT;
