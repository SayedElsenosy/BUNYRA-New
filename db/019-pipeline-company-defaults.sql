BEGIN;

CREATE OR REPLACE FUNCTION crm_seed_default_pipeline_stages() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO crm_pipeline_stages(company_id,name,name_en,position) VALUES
    (NEW.id,'جديد','New',0),
    (NEW.id,'تم التواصل','Contacted',1),
    (NEW.id,'مؤهل','Qualified',2),
    (NEW.id,'عرض سعر','Proposal',3),
    (NEW.id,'ناجح','Won',4),
    (NEW.id,'خاسر','Lost',5)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_seed_pipeline_stages ON companies;
CREATE TRIGGER companies_seed_pipeline_stages AFTER INSERT ON companies FOR EACH ROW EXECUTE FUNCTION crm_seed_default_pipeline_stages();

INSERT INTO crm_pipeline_stages(company_id,name,name_en,position)
SELECT c.id,s.name,s.name_en,s.position
FROM companies c
CROSS JOIN (VALUES
  ('جديد','New',0),('تم التواصل','Contacted',1),('مؤهل','Qualified',2),
  ('عرض سعر','Proposal',3),('ناجح','Won',4),('خاسر','Lost',5)
) AS s(name,name_en,position)
WHERE NOT EXISTS(SELECT 1 FROM crm_pipeline_stages x WHERE x.company_id=c.id AND x.name=s.name)
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('019-pipeline-company-defaults');
COMMIT;
