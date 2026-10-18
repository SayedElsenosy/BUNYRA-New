# Company settings and organization

The company detail screen now includes Settings, Organization, and Staff assignments in Arabic/English and both existing themes. Platform owners use an explicit audited platform context. Members use company.read; settings and structure writes require company.write, and staff assignments require members.manage. Project assignment also checks project read access. Organization assignment never grants application permissions.

Settings include company contact data, an HTTPS hosted logo reference, default currency, time zone, and language. Defaults are EGP/Africa/Cairo/ar until saved. Existing financial records are not recalculated. Logo file uploads/storage are not implemented by this phase; the form accepts an existing hosted image URL.

Organization nodes support branches, departments, teams, legal entities, and cost centers. Nodes have stable codes, bilingual names, an optional active member as manager, and a status. Departments may link to branches, teams to departments, and cost centers to legal entities. Independent nodes are supported. Entity kinds cannot be changed after creation. Composite foreign keys prevent cross-company parents, managers, projects, and member links. Active dependencies block node deactivation. There is no destructive delete endpoint.

Staff can be associated with multiple nodes and optionally a project. Existing assignments can be deactivated/reactivated without deleting their history. Staff need to accept a real invitation before they can be selected; no user accounts or organization data are invented for the production company.

Writes lock the company row, check versions, and write the audit record in the same transaction. RLS exposes tenant reads only with an active membership and matching company context. The application database credential remains server-only.

Migration: db/003-company-organization.sql, tested first on the isolated Neon development branch. Integration suite: scripts/test-organization.mjs executes the actual transpiled service source, including database constraints, RLS, permission denials, version conflicts, and audit evidence. CLI reproduction: npm run test:organization with BUNYRA_TEST_DATABASE_URL and BUNYRA_ALLOW_TEST_FIXTURES=1 targeting an isolated branch. Never use production for fixtures.

Next functional milestone is the project setup wizard (request 7). This phase does not imply that all earlier ERP requirements are complete: subscription management, company application approval, safe company deletion/retention, MFA, full project/inventory/finance/CRM modules remain separately tracked work.
