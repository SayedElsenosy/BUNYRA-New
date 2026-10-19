BEGIN;
ALTER TABLE app_accounts ALTER COLUMN must_change_password SET DEFAULT false;
UPDATE app_accounts SET must_change_password=false WHERE must_change_password;
ALTER TABLE member_permissions DROP CONSTRAINT member_permissions_action_check;
ALTER TABLE member_permissions ADD CONSTRAINT member_permissions_action_check CHECK(action IN('company.read','company.write','projects.read','projects.write','plans.publish','inventory.read','inventory.write','leads.read','leads.write','bookings.read','bookings.create','bookings.approve','bookings.cancel','finance.read','finance.write','finance.approve','members.manage','accounts.manage','roles.manage','audit.read','offers.create','contracts.write','commissions.write'));
INSERT INTO schema_migrations(version) VALUES('014-admin-managed-profiles');
COMMIT;
