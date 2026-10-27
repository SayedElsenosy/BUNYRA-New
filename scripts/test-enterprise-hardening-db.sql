\set ON_ERROR_STOP on
-- Local disposable Postgres only; called by test-enterprise-hardening-db.mjs.
-- Fixtures use normal triggers and constraints. The transaction is rolled back.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'bunyra_hardening_test' THEN
  RAISE EXCEPTION 'This fixture is restricted to the disposable local hardening database';
 END IF;
END $$;
CREATE TEMP TABLE hardening_checks(label text PRIMARY KEY);
GRANT SELECT,INSERT ON hardening_checks TO bunyra_tenant;
CREATE FUNCTION pg_temp.check_ok(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'CHECK FAILED: %',label; END IF;
 INSERT INTO hardening_checks VALUES(label);
END $$;
CREATE FUNCTION pg_temp.expect_error(statement text,expected_code text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_code text; actual_message text;
BEGIN
 BEGIN
  EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual_code=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT;
 END;
 IF actual_code IS DISTINCT FROM expected_code OR
    (expected_message IS NOT NULL AND actual_message IS DISTINCT FROM expected_message) THEN
  RAISE EXCEPTION 'CHECK FAILED: %, expected %/%, got %/%',label,expected_code,expected_message,actual_code,actual_message;
 END IF;
 PERFORM pg_temp.check_ok(true,label);
END $$;

\set company '11000000-0000-4000-8000-000000000001'
\set foreign_company '11000000-0000-4000-8000-000000000002'
\set project '22000000-0000-4000-8000-000000000001'
\set customer '33000000-0000-4000-8000-000000000001'
\set unit '44000000-0000-4000-8000-000000000001'
\set book '55000000-0000-4000-8000-000000000001'
\set plan '66000000-0000-4000-8000-000000000001'
\set booking '77000000-0000-4000-8000-000000000001'
\set contract '88000000-0000-4000-8000-000000000001'
\set installment '99000000-0000-4000-8000-000000000001'
\set document 'aa000000-0000-4000-8000-000000000001'
\set revision 'aa000000-0000-4000-8000-000000000002'
\set template 'bb000000-0000-4000-8000-000000000001'
\set adjustment 'cc000000-0000-4000-8000-000000000001'

INSERT INTO companies(id,name,account_limit) VALUES(:'company','Hardening fixture',10),(:'foreign_company','Foreign fixture',10);
INSERT INTO memberships(company_id,user_id,email,role) VALUES
(:'company','maker','maker@example.test','company_admin'),
(:'company','checker','checker@example.test','finance_manager'),
(:'company','seller','seller@example.test','sales'),
(:'company','accountant','accountant@example.test','accountant'),
(:'foreign_company','foreign','foreign@example.test','company_admin');
INSERT INTO projects(id,company_id,name) VALUES(:'project',:'company','Original project');
INSERT INTO crm_customers(id,company_id,full_name,phone,normalized_phone,national_id,created_by)
 VALUES(:'customer',:'company','Original customer','01000000000','01000000000','12345678901234','seller');
INSERT INTO inventory_units(id,company_id,project_id,code,building,floor,category,area,proposed_price_minor)
 VALUES(:'unit',:'company',:'project','ORIGINAL-1','A','1','Residential',100,100000);
SELECT set_config('app.company_id',:'company',true),set_config('app.user_id','maker',true);
INSERT INTO price_books(id,company_id,project_id,name,currency,created_by)
 VALUES(:'book',:'company',:'project','Fixture price book','USD','maker');
INSERT INTO price_book_plans(id,company_id,project_id,book_id,code,name,down_payment_bps,installments,interval_months)
 VALUES(:'plan',:'company',:'project',:'book','FIXTURE','Fixture plan',0,2,1);
INSERT INTO bookings(id,company_id,project_id,unit_id,customer_id,book_id,plan_id,customer_name,
 customer_phone,customer_email,correspondence_address,requested_amount_minor,reservation_amount_minor,sales_user_id)
 VALUES(:'booking',:'company',:'project',:'unit',:'customer',:'book',:'plan','Original buyer snapshot',
 '01000000000','buyer@example.test','Original address',100000,0,'seller');
INSERT INTO contract_templates(id,company_id,name,created_by) VALUES(:'template',:'company','Original template','maker');
INSERT INTO contract_template_files(company_id,template_id,original_name,file_size,sha256,object_key)
 VALUES(:'company',:'template','original.docx',1000,repeat('a',64),'fixture/original.docx');

-- 071: ordinary sales users can maintain evidence on submitted bookings only.
SET LOCAL ROLE bunyra_tenant;
SELECT set_config('app.user_id','seller',true);
INSERT INTO booking_documents(id,company_id,booking_id,kind,original_name,mime_type,file_size,sha256,object_key,created_by)
 VALUES(:'document',:'company',:'booking','id_card','original.png','image/png',10,repeat('b',64),'fixture/original.png','seller');
SELECT pg_temp.check_ok((SELECT status='ready' FROM booking_documents WHERE id=:'document'),'submitted booking accepts seller evidence');
SELECT pg_temp.expect_error(format('UPDATE booking_documents SET original_name=''tampered.png'' WHERE id=%L',:'document'),
 '42501',NULL,'tenant cannot rewrite evidence metadata');
SELECT pg_temp.expect_error(format('DELETE FROM booking_documents WHERE id=%L',:'document'),
 '42501',NULL,'tenant cannot delete original evidence');
UPDATE booking_documents SET status='superseded' WHERE id=:'document';
INSERT INTO booking_documents(id,company_id,booking_id,kind,original_name,mime_type,file_size,sha256,object_key,created_by)
 VALUES(:'revision',:'company',:'booking','id_card','revision.png','image/png',20,repeat('c',64),'fixture/revision.png','seller');
SELECT pg_temp.check_ok((SELECT count(*)=2 AND count(*) FILTER(WHERE status='ready')=1
 FROM booking_documents WHERE booking_id=:'booking'),'replacement preserves original and exactly one current revision');
SELECT pg_temp.expect_error(format('UPDATE booking_documents SET status=''ready'' WHERE id=%L',:'document'),
 '23514','DOCUMENT_IMMUTABLE','superseded evidence cannot become current again');
SELECT pg_temp.expect_error(format('INSERT INTO booking_documents(company_id,booking_id,kind,original_name,mime_type,file_size,sha256,object_key,created_by) VALUES(%L,%L,''payment_proof'',''fake.png'',''image/png'',10,%L,''fixture/spoof.png'',''maker'')',:'company',:'booking',repeat('d',64)),
 '42501','DOCUMENT_FORBIDDEN','tenant cannot spoof evidence author');
SELECT set_config('app.user_id','maker',true);
UPDATE bookings SET status='accounts_confirmed' WHERE id=:'booking';
SELECT set_config('app.user_id','seller',true);
SELECT pg_temp.expect_error(format('UPDATE booking_documents SET status=''superseded'' WHERE id=%L',:'revision'),
 '42501','DOCUMENT_FORBIDDEN','seller cannot replace evidence after approval');
SELECT set_config('app.user_id','maker',true);
UPDATE booking_documents SET status='superseded' WHERE id=:'revision';
INSERT INTO booking_documents(company_id,booking_id,kind,original_name,mime_type,file_size,sha256,object_key,created_by)
 VALUES(:'company',:'booking','id_card','approved.png','image/png',30,repeat('d',64),'fixture/approved.png','maker');
SELECT pg_temp.check_ok((SELECT count(*)=3 FROM booking_documents WHERE booking_id=:'booking'),
 'authorized post-approval replacement retains all evidence versions');
RESET ROLE;
SELECT pg_temp.expect_error(format('UPDATE booking_documents SET sha256=%L WHERE id=%L',repeat('e',64),:'document'),
 '23514','DOCUMENT_IMMUTABLE','evidence trigger also prevents privileged metadata rewrites');

-- 073: deferred capture sees the complete original schedule in the same transaction.
INSERT INTO contracts(id,company_id,booking_id,customer_id,project_id,unit_id,contract_number,value_final_minor,payment_plan_snapshot,signed_at,created_by)
 VALUES(:'contract',:'company',:'booking',:'customer',:'project',:'unit','FIXTURE-001',100000,
 '{"book":{"currency":"USD"}}','2026-10-26 22:30:00+00','maker');
INSERT INTO contract_installments(id,company_id,contract_id,number,due_date,amount_minor)
 VALUES(:'installment',:'company',:'contract',1,'2026-11-01',50000),
 ('99000000-0000-4000-8000-000000000002',:'company',:'contract',2,'2026-12-01',50000);
SELECT pg_temp.check_ok(NOT EXISTS(SELECT 1 FROM contract_word_snapshots WHERE contract_id=:'contract'),
 'snapshot waits until schedule has been inserted');
SET CONSTRAINTS contract_word_snapshot_at_commit IMMEDIATE;
SELECT pg_temp.check_ok((SELECT template_id=:'template' AND template_object_key='fixture/original.docx'
 AND data_snapshot->>'customer_name'='Original buyer snapshot' AND data_snapshot->>'national_id'='12345678901234'
 AND data_snapshot->>'unit_area'='100.00' AND data_snapshot->>'signed_date'='2026-10-27'
 AND data_snapshot->>'currency'='USD' AND jsonb_array_length(data_snapshot->'installments')=2
 FROM contract_word_snapshots WHERE contract_id=:'contract'),'signing freezes legal data, template, Cairo date, currency and full schedule');
UPDATE projects SET name='Changed project' WHERE id=:'project';
UPDATE inventory_units SET area=120 WHERE id=:'unit';
UPDATE crm_customers SET national_id='99999999999999' WHERE id=:'customer';
UPDATE contract_templates SET active=false WHERE id=:'template';
INSERT INTO contract_templates(company_id,name,created_by) VALUES(:'company','New active template','maker');
SELECT pg_temp.check_ok((SELECT template_id=:'template' AND data_snapshot->>'project_name'='Original project'
 AND data_snapshot->>'national_id'='12345678901234' AND data_snapshot->>'unit_area'='100.00'
 FROM contract_word_snapshots WHERE contract_id=:'contract'),'later master data and active-template changes do not rewrite contract snapshot');
SELECT pg_temp.expect_error(format('UPDATE contract_word_snapshots SET data_snapshot=''{}'' WHERE contract_id=%L',:'contract'),
 '23514','CONTRACT_WORD_IMMUTABLE','privileged snapshot rewriting is rejected');
SET LOCAL ROLE bunyra_tenant;
SELECT pg_temp.expect_error(format('INSERT INTO contract_word_snapshots(company_id,contract_id,data_snapshot,captured_by) VALUES(%L,%L,''{}'',''maker'')',:'company',:'contract'),
 '42501',NULL,'tenant cannot forge signing snapshots');
INSERT INTO contract_word_files(company_id,contract_id,object_key,sha256,file_size,original_name,generated_by)
 VALUES(:'company',:'contract',:'company'||'/contracts/issued/'||:'contract'||'/dd000000-0000-4000-8000-000000000001.docx',repeat('f',64),2000,'signed.docx','maker');
SELECT pg_temp.expect_error(format('INSERT INTO contract_word_files(company_id,contract_id,object_key,sha256,file_size,original_name,generated_by) VALUES(%L,%L,%L,%L,2001,''replacement.docx'',''maker'')',:'company',:'contract',:'company'||'/contracts/issued/'||:'contract'||'/dd000000-0000-4000-8000-000000000002.docx',repeat('f',64)),
 '23505',NULL,'duplicate generation cannot replace the canonical Word file');
SELECT pg_temp.expect_error(format('UPDATE contract_word_files SET file_size=2001 WHERE contract_id=%L',:'contract'),
 '42501',NULL,'tenant cannot rewrite canonical Word metadata');
RESET ROLE;
SELECT pg_temp.expect_error(format('DELETE FROM contract_word_files WHERE contract_id=%L',:'contract'),
 '23514','CONTRACT_WORD_IMMUTABLE','privileged deletion of the canonical file is rejected');

-- A template configured later cannot become the historical signing template.
SET CONSTRAINTS contract_word_snapshot_at_commit DEFERRED;
INSERT INTO inventory_units(id,company_id,project_id,code,building,floor,category,area,proposed_price_minor)
 VALUES('44000000-0000-4000-8000-000000000002',:'company',:'project','NO-TEMPLATE','A','1','Residential',100,100000);
INSERT INTO bookings(id,company_id,project_id,unit_id,customer_id,book_id,plan_id,customer_name,
 customer_phone,requested_amount_minor,reservation_amount_minor,sales_user_id)
 VALUES('77000000-0000-4000-8000-000000000002',:'company',:'project','44000000-0000-4000-8000-000000000002',
 :'customer',:'book',:'plan','No template buyer','01000000000',100000,0,'seller');
INSERT INTO contracts(id,company_id,booking_id,customer_id,project_id,unit_id,contract_number,value_final_minor,payment_plan_snapshot,created_by)
 VALUES('88000000-0000-4000-8000-000000000002',:'company','77000000-0000-4000-8000-000000000002',:'customer',
 :'project','44000000-0000-4000-8000-000000000002','NO-TEMPLATE-001',100000,'{}','maker');
INSERT INTO contract_installments(company_id,contract_id,number,due_date,amount_minor)
 VALUES(:'company','88000000-0000-4000-8000-000000000002',1,'2026-12-01',100000);
SET CONSTRAINTS contract_word_snapshot_at_commit IMMEDIATE;
SELECT pg_temp.check_ok((SELECT template_id IS NULL AND jsonb_array_length(data_snapshot->'installments')=1
 FROM contract_word_snapshots WHERE contract_id='88000000-0000-4000-8000-000000000002'),
 'signing without a configured template preserves that explicit absence');
INSERT INTO contract_template_files(company_id,template_id,original_name,file_size,sha256,object_key)
 SELECT :'company',id,'later.docx',1000,repeat('1',64),'fixture/later.docx'
 FROM contract_templates WHERE company_id=:'company' AND active;
SET LOCAL ROLE bunyra_tenant;
SELECT pg_temp.expect_error(format('INSERT INTO contract_word_files(company_id,contract_id,object_key,sha256,file_size,original_name,generated_by) VALUES(%L,''88000000-0000-4000-8000-000000000002'',%L,%L,2001,''later.docx'',''maker'')',
 :'company',:'company'||'/contracts/issued/88000000-0000-4000-8000-000000000002/dd000000-0000-4000-8000-000000000003.docx',repeat('1',64)),
 '23514','CONTRACT_WORD_SNAPSHOT_INVALID','later template configuration cannot publish a different historical contract');
RESET ROLE;

-- The underlying FK permits a contract and its booking to reference different
-- projects. Publication must mirror requireBooking()'s booking-project scope.
SET CONSTRAINTS contract_word_snapshot_at_commit DEFERRED;
INSERT INTO projects(id,company_id,name)
 VALUES('22000000-0000-4000-8000-000000000002',:'company','Denied booking project');
INSERT INTO inventory_units(id,company_id,project_id,code,building,floor,category,area,proposed_price_minor)
 VALUES('44000000-0000-4000-8000-000000000003',:'company','22000000-0000-4000-8000-000000000002','DENIED-BOOKING','A','1','Residential',100,100000);
INSERT INTO price_books(id,company_id,project_id,name,currency,created_by)
 VALUES('55000000-0000-4000-8000-000000000002',:'company','22000000-0000-4000-8000-000000000002','Other fixture book','EGP','maker');
INSERT INTO price_book_plans(id,company_id,project_id,book_id,code,name,down_payment_bps,installments,interval_months)
 VALUES('66000000-0000-4000-8000-000000000002',:'company','22000000-0000-4000-8000-000000000002',
 '55000000-0000-4000-8000-000000000002','FIXTURE','Fixture plan',0,2,1);
INSERT INTO bookings(id,company_id,project_id,unit_id,customer_id,book_id,plan_id,customer_name,
 customer_phone,requested_amount_minor,reservation_amount_minor,sales_user_id)
 VALUES('77000000-0000-4000-8000-000000000003',:'company','22000000-0000-4000-8000-000000000002',
 '44000000-0000-4000-8000-000000000003',:'customer','55000000-0000-4000-8000-000000000002',
 '66000000-0000-4000-8000-000000000002','Mismatched project buyer','01000000000',100000,0,'seller');
INSERT INTO contracts(id,company_id,booking_id,customer_id,project_id,unit_id,contract_number,value_final_minor,payment_plan_snapshot,created_by)
 VALUES('88000000-0000-4000-8000-000000000003',:'company','77000000-0000-4000-8000-000000000003',:'customer',
 :'project',:'unit','MISMATCH-001',100000,'{}','maker');
INSERT INTO contract_installments(company_id,contract_id,number,due_date,amount_minor)
 VALUES(:'company','88000000-0000-4000-8000-000000000003',1,'2026-12-01',100000);
SET CONSTRAINTS contract_word_snapshot_at_commit IMMEDIATE;
INSERT INTO member_permissions(company_id,user_id,project_id,action,allowed)
 VALUES(:'company','maker','22000000-0000-4000-8000-000000000002','bookings.read',false);
SET LOCAL ROLE bunyra_tenant;
SELECT pg_temp.check_ok(NOT bunyra_contract_word_reader(:'company','88000000-0000-4000-8000-000000000003'),
 'contract publication authorizes the booking project, not a different contract project');
SELECT pg_temp.expect_error(format('INSERT INTO contract_word_files(company_id,contract_id,object_key,sha256,file_size,original_name,generated_by) VALUES(%L,''88000000-0000-4000-8000-000000000003'',%L,%L,2001,''denied.docx'',''maker'')',
 :'company',:'company'||'/contracts/issued/88000000-0000-4000-8000-000000000003/dd000000-0000-4000-8000-000000000004.docx',repeat('1',64)),
 '42501','CONTRACT_WORD_FORBIDDEN','direct manifest publication cannot bypass a booking-project denial');
RESET ROLE;

-- 072: independent approval and execution are enforced even on direct SQL.
SET LOCAL ROLE bunyra_tenant;
SELECT set_config('app.user_id','seller',true);
SELECT pg_temp.expect_error(format('INSERT INTO financial_adjustments(company_id,contract_id,installment_id,kind,amount_minor,reason,created_by) VALUES(%L,%L,%L,''settlement'',100,''Unauthorized seller'',''seller'')',:'company',:'contract',:'installment'),
 '42501','FORBIDDEN','sales cannot create adjustments via direct tenant SQL');
SELECT set_config('app.user_id','accountant',true);
SELECT pg_temp.expect_error(format('INSERT INTO financial_adjustments(company_id,contract_id,installment_id,kind,amount_minor,reason,created_by) VALUES(%L,%L,%L,''settlement'',100,''Unassigned accountant'',''accountant'')',:'company',:'contract',:'installment'),
 '42501','FORBIDDEN','accountant requires an explicit finance.write project grant');
RESET ROLE;
INSERT INTO member_permissions(company_id,user_id,project_id,action,allowed)
 VALUES(:'company','accountant',:'project','finance.write',true);
SET LOCAL ROLE bunyra_tenant;
INSERT INTO financial_adjustments(company_id,contract_id,installment_id,kind,amount_minor,reason,created_by)
 VALUES(:'company',:'contract',:'installment','settlement',100,'Scoped accountant','accountant');
SELECT pg_temp.check_ok(EXISTS(SELECT 1 FROM financial_adjustments WHERE created_by='accountant'),
 'accountant project grant permits requests in that project');
SELECT set_config('app.user_id','maker',true);
INSERT INTO financial_adjustments(id,company_id,contract_id,installment_id,kind,amount_minor,reason,created_by)
 VALUES(:'adjustment',:'company',:'contract',:'installment','settlement',100,'Fixture settlement','maker');
SELECT pg_temp.expect_error(format('UPDATE financial_adjustments SET status=''approved'',approved_by=''maker'',approved_at=now() WHERE id=%L',:'adjustment'),
 '42501','ADJUSTMENT_SELF_APPROVAL','maker cannot approve own adjustment');
SELECT pg_temp.expect_error(format('UPDATE financial_adjustments SET status=''approved'',approved_by=''checker'',approved_at=now() WHERE id=%L',:'adjustment'),
 '42501','FORBIDDEN','maker cannot spoof checker identity');
SELECT pg_temp.expect_error(format('UPDATE financial_adjustments SET created_by=''checker'' WHERE id=%L',:'adjustment'),
 '23514','ADJUSTMENT_TERMS_IMMUTABLE','maker cannot transfer authorship to bypass self approval');
SELECT pg_temp.expect_error(format('UPDATE financial_adjustments SET amount_minor=99 WHERE id=%L',:'adjustment'),
 '23514','ADJUSTMENT_TERMS_IMMUTABLE','requested amount is immutable');
SELECT pg_temp.expect_error(format('INSERT INTO financial_adjustments(company_id,contract_id,installment_id,kind,amount_minor,reason,created_by,status,approved_by,approved_at) VALUES(%L,%L,%L,''settlement'',100,''Bypass requested'',''maker'',''approved'',''checker'',now())',:'company',:'contract',:'installment'),
 '23514','ADJUSTMENT_INVALID_TRANSITION','insert cannot bypass requested state');
SELECT pg_temp.expect_error(format('INSERT INTO financial_adjustments(company_id,contract_id,installment_id,kind,amount_minor,reason,created_by) VALUES(%L,%L,%L,''settlement'',100,''Spoof creator'',''checker'')',:'company',:'contract',:'installment'),
 '42501','FORBIDDEN','tenant cannot spoof adjustment creator');
SELECT set_config('app.user_id','seller',true);
SELECT pg_temp.expect_error(format('UPDATE financial_adjustments SET status=''approved'',approved_by=''seller'',approved_at=now() WHERE id=%L',:'adjustment'),
 '42501','FORBIDDEN','sales cannot approve adjustments via direct tenant SQL');
RESET ROLE;
INSERT INTO member_permissions(company_id,user_id,project_id,action,allowed) VALUES
 (:'company','checker',NULL,'finance.approve',false),
 (:'company','checker',:'project','finance.approve',true);
SET LOCAL ROLE bunyra_tenant;
SELECT set_config('app.user_id','checker',true);
SELECT pg_temp.expect_error(format('UPDATE financial_adjustments SET status=''approved'',approved_by=''checker'',approved_at=now() WHERE id=%L',:'adjustment'),
 '42501','FORBIDDEN','project grant cannot override company finance.approve denial');
RESET ROLE;
DELETE FROM member_permissions WHERE company_id=:'company' AND user_id='checker';
SET LOCAL ROLE bunyra_tenant;
SELECT set_config('app.user_id','checker',true);
UPDATE financial_adjustments SET status='approved',approved_by='checker',approved_at=now() WHERE id=:'adjustment';
SELECT pg_temp.check_ok((SELECT status='approved' AND approved_by='checker' FROM financial_adjustments WHERE id=:'adjustment'),
 'independent checker can approve the request');
SELECT pg_temp.expect_error(format('UPDATE financial_adjustments SET status=''executed'',executed_by=''checker'',executed_at=now() WHERE id=%L',:'adjustment'),
 '42501','ADJUSTMENT_INDEPENDENT_EXECUTOR','approver cannot execute the adjustment');
SELECT pg_temp.expect_error(format('SELECT bunyra_execute_adjustment(%L,%L,''maker'',''maker@example.test'')',:'company',:'adjustment'),
 '42501','FORBIDDEN','approver cannot spoof maker when calling the execution function');
SELECT pg_temp.check_ok((SELECT paid_minor=0 FROM contract_installments WHERE id=:'installment'),
 'failed spoof execution rolls back all installment changes');
SELECT pg_temp.expect_error(format('UPDATE financial_adjustments SET approved_by=''maker'' WHERE id=%L',:'adjustment'),
 '23514','ADJUSTMENT_TERMS_IMMUTABLE','approval author cannot be rewritten');
SELECT set_config('app.user_id','seller',true);
SELECT pg_temp.expect_error(format('SELECT bunyra_execute_adjustment(%L,%L,''seller'',''seller@example.test'')',:'company',:'adjustment'),
 '42501','FORBIDDEN','sales cannot execute an approved adjustment via SQL function');
SELECT set_config('app.user_id','maker',true);
SELECT pg_temp.expect_error(format('UPDATE financial_adjustments SET status=''executed'',executed_by=''maker'',executed_at=now() WHERE id=%L',:'adjustment'),
 '42501','ADJUSTMENT_POSTING_REQUIRED','independent executor cannot skip the installment posting function');
SELECT pg_temp.expect_error(format('SELECT bunyra_execute_adjustment_internal(%L,%L,''maker'',''maker@example.test'')',:'company',:'adjustment'),
 '42501',NULL,'tenant cannot invoke the unchecked internal posting function');
SELECT bunyra_execute_adjustment(:'company',:'adjustment','maker','maker@example.test');
SELECT pg_temp.check_ok((SELECT status='executed' AND approved_by='checker' AND executed_by='maker'
 FROM financial_adjustments WHERE id=:'adjustment'),'maker can execute only after independent approval');
SELECT pg_temp.check_ok((SELECT paid_minor=100 FROM contract_installments WHERE id=:'installment'),
 'valid execution updates the installment once');
SELECT pg_temp.expect_error(format('SELECT bunyra_execute_adjustment(%L,%L,''maker'',''maker@example.test'')',:'company',:'adjustment'),
 'P0001','INVALID_STATUS','executed adjustment cannot be replayed');
SELECT pg_temp.expect_error(format('UPDATE financial_adjustments SET status=''requested'' WHERE id=%L',:'adjustment'),
 '23514','ADJUSTMENT_INVALID_TRANSITION','executed adjustment cannot return to requested');

-- Simulate one row that predates migration072. Only this new guard is disabled
-- while creating the historical fixture; all other constraints remain active.
RESET ROLE;
ALTER TABLE financial_adjustments DISABLE TRIGGER adjustment_separation_of_duties;
INSERT INTO financial_adjustments(id,company_id,contract_id,installment_id,kind,amount_minor,reason,created_by,status,approved_by,approved_at)
 VALUES('cc000000-0000-4000-8000-000000000002',:'company',:'contract',:'installment','settlement',100,
 'Pre migration self approved','maker','approved','maker',now());
ALTER TABLE financial_adjustments ENABLE TRIGGER adjustment_separation_of_duties;
SET LOCAL ROLE bunyra_tenant;
SELECT set_config('app.user_id','accountant',true);
SELECT pg_temp.expect_error(format('SELECT bunyra_execute_adjustment(%L,''cc000000-0000-4000-8000-000000000002'',''accountant'',''accountant@example.test'')',:'company'),
 '42501','ADJUSTMENT_INDEPENDENT_EXECUTOR','legacy self-approved adjustment cannot execute after migration');
SELECT pg_temp.check_ok((SELECT paid_minor=100 FROM contract_installments WHERE id=:'installment'),
 'rejected legacy adjustment does not alter installment balance');

-- Cross-company context is also checked by the real tenant role/RLS.
SELECT set_config('app.company_id',:'foreign_company',true),set_config('app.user_id','foreign',true);
SELECT pg_temp.check_ok((SELECT count(*)=0 FROM booking_documents),'foreign company cannot read evidence');
SELECT pg_temp.check_ok((SELECT count(*)=0 FROM contract_word_snapshots),'foreign company cannot read signing snapshots');
SELECT pg_temp.check_ok((SELECT count(*)=0 FROM contract_word_files),'foreign company cannot read canonical contract files');
SELECT pg_temp.check_ok((SELECT count(*)=0 FROM financial_adjustments),'foreign company cannot read adjustments');
RESET ROLE;
SELECT count(*) AS passed_database_checks FROM hardening_checks;
ROLLBACK;
