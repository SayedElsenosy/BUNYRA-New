BEGIN;

CREATE TABLE crm_pipeline_stages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 80),
 name_en text NOT NULL DEFAULT '' CHECK(length(name_en)<=80),
 position integer NOT NULL CHECK(position>=0),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 UNIQUE(company_id,name),
 UNIQUE(company_id,position)
);
CREATE INDEX crm_pipeline_stages_order ON crm_pipeline_stages(company_id,active,position);

ALTER TABLE crm_leads ADD COLUMN stage_id uuid;
ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_stage_fk FOREIGN KEY(company_id,stage_id) REFERENCES crm_pipeline_stages(company_id,id);
CREATE INDEX crm_leads_stage ON crm_leads(company_id,stage_id,updated_at DESC);

CREATE TABLE crm_sales_teams(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
 manager_user_id text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 UNIQUE(company_id,name),
 FOREIGN KEY(company_id,manager_user_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX crm_sales_teams_manager ON crm_sales_teams(company_id,manager_user_id,active);

CREATE TABLE crm_sales_team_members(
 company_id uuid NOT NULL REFERENCES companies(id),
 team_id uuid NOT NULL,
 user_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,team_id,user_id),
 FOREIGN KEY(company_id,team_id) REFERENCES crm_sales_teams(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
);

CREATE TABLE crm_lead_transfers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 lead_id uuid NOT NULL,
 from_user_id text,
 to_user_id text NOT NULL,
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=500),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,lead_id) REFERENCES crm_leads(company_id,id),
 FOREIGN KEY(company_id,to_user_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX crm_lead_transfers_history ON crm_lead_transfers(company_id,lead_id,created_at DESC);

INSERT INTO crm_pipeline_stages(company_id,name,name_en,position)
SELECT id,'جديد','New',0 FROM companies WHERE status<>'deleted'
ON CONFLICT(company_id,name) DO NOTHING;
INSERT INTO crm_pipeline_stages(company_id,name,name_en,position)
SELECT id,'تم التواصل','Contacted',1 FROM companies WHERE status<>'deleted'
ON CONFLICT(company_id,name) DO NOTHING;
INSERT INTO crm_pipeline_stages(company_id,name,name_en,position)
SELECT id,'مؤهل','Qualified',2 FROM companies WHERE status<>'deleted'
ON CONFLICT(company_id,name) DO NOTHING;
INSERT INTO crm_pipeline_stages(company_id,name,name_en,position)
SELECT id,'عرض سعر','Proposal',3 FROM companies WHERE status<>'deleted'
ON CONFLICT(company_id,name) DO NOTHING;
INSERT INTO crm_pipeline_stages(company_id,name,name_en,position)
SELECT id,'ناجح','Won',4 FROM companies WHERE status<>'deleted'
ON CONFLICT(company_id,name) DO NOTHING;
INSERT INTO crm_pipeline_stages(company_id,name,name_en,position)
SELECT id,'خاسر','Lost',5 FROM companies WHERE status<>'deleted'
ON CONFLICT(company_id,name) DO NOTHING;

GRANT SELECT,INSERT,UPDATE ON crm_pipeline_stages,crm_sales_teams,crm_sales_team_members,crm_lead_transfers TO bunyra_tenant;
ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipeline_stages FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_sales_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sales_teams FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_sales_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sales_team_members FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_pipeline_stages_scope ON crm_pipeline_stages TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
CREATE POLICY crm_sales_teams_scope ON crm_sales_teams TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
CREATE POLICY crm_sales_team_members_scope ON crm_sales_team_members TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));
CREATE POLICY crm_lead_transfers_scope ON crm_lead_transfers TO bunyra_tenant USING(company_id=(SELECT bunyra_tenant_company())) WITH CHECK(company_id=(SELECT bunyra_tenant_company()));

INSERT INTO schema_migrations(version) VALUES('018-sales-pipeline');
COMMIT;
