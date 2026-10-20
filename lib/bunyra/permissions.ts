export const ACTIONS = ['company.read','company.write','projects.read','projects.write','plans.publish','inventory.read','inventory.write','pricing.read','pricing.write','pricing.approve','leads.read','leads.write','bookings.read','bookings.create','bookings.approve','bookings.cancel','finance.read','finance.write','finance.approve','members.manage','accounts.manage','roles.manage','audit.read','offers.create','contracts.write','commissions.write','commissions.read','commissions.pay','reports.read'] as const;
export type Action = typeof ACTIONS[number];
export const ROLES = ['company_admin','operations','sales','sales_manager','sales_admin','finance_manager','accountant'] as const;
export type Role = typeof ROLES[number];
const grants: Record<Role,readonly Action[]> = {
 company_admin:ACTIONS,
 operations:['commissions.read','reports.read','pricing.read','pricing.write','accounts.manage','company.read','projects.read','inventory.read','inventory.write','leads.read','bookings.read','bookings.approve','bookings.cancel','offers.create','contracts.write','commissions.write'],
 sales:['commissions.read','reports.read','pricing.read','company.read','projects.read','inventory.read','leads.read','leads.write','bookings.read','bookings.create','offers.create'],
 sales_manager:['commissions.read','reports.read','pricing.read','company.read','projects.read','inventory.read','leads.read','leads.write','bookings.read','bookings.create','offers.create'],
 sales_admin:['commissions.read','reports.read','pricing.read','company.read','projects.read','inventory.read','leads.read','leads.write'],
 finance_manager:['commissions.read','commissions.pay','reports.read','company.read','projects.read','finance.read','finance.write','finance.approve','bookings.read','audit.read'],
 accountant:['commissions.read','commissions.pay','reports.read','company.read','projects.read','finance.read','finance.write','bookings.read'],
};
export type PermissionOverride={action:string;project_id:string|null;allowed:boolean};
export function hasPermission(role:Role, custom:Record<string,boolean>|null, overrides:PermissionOverride[], action:Action, projectId?:string){
 const project=projectId?overrides.find(p=>p.action===action&&p.project_id===projectId):undefined;
 if(project)return project.allowed;
 const company=overrides.find(p=>p.action===action&&p.project_id===null);
 if(company)return company.allowed;
 return custom!==null?custom[action]===true:grants[role]?.includes(action)===true;
}
