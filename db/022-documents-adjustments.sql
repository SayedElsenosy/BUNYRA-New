BEGIN;

CREATE TABLE booking_documents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,booking_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('id_card','payment_proof')),original_name text NOT NULL,mime_type text NOT NULL,file_size integer NOT NULL CHECK(file_size>0 AND file_size<=10485760),sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),object_key text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'ready' CHECK(status IN('ready','rejected','deleted')),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,booking_id) REFERENCES bookings(company_id,id),UNIQUE(company_id,booking_id,kind)
);
CREATE INDEX booking_documents_booking ON booking_documents(company_id,booking_id,created_at DESC);

ALTER TABLE collections ADD CONSTRAINT collections_company_id_id UNIQUE(company_id,id);

CREATE TABLE financial_adjustments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,contract_id uuid NOT NULL,installment_id uuid,collection_id uuid,kind text NOT NULL CHECK(kind IN('refund','reversal','settlement')),amount_minor bigint NOT NULL CHECK(amount_minor>0),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),status text NOT NULL DEFAULT 'requested' CHECK(status IN('requested','approved','executed','rejected','voided')),reference text NOT NULL DEFAULT '',created_by text NOT NULL,approved_by text,executed_by text,approved_at timestamptz,executed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,contract_id) REFERENCES contracts(company_id,id),FOREIGN KEY(company_id,installment_id) REFERENCES contract_installments(company_id,id),FOREIGN KEY(company_id,collection_id) REFERENCES collections(company_id,id),CHECK((kind IN('refund','reversal'))=(collection_id IS NOT NULL) OR (kind='settlement' AND collection_id IS NULL))
);
CREATE INDEX financial_adjustments_status ON financial_adjustments(company_id,status,created_at DESC);
CREATE INDEX financial_adjustments_contract ON financial_adjustments(company_id,contract_id,created_at DESC);

ALTER TABLE booking_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE financial_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_adjustments FORCE ROW LEVEL SECURITY;
CREATE POLICY booking_documents_scope ON booking_documents TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
CREATE POLICY financial_adjustments_scope ON financial_adjustments TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
GRANT SELECT,INSERT,UPDATE ON booking_documents,financial_adjustments TO bunyra_tenant;

INSERT INTO schema_migrations(version) VALUES('022-documents-adjustments');
COMMIT;
