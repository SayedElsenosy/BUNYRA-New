import {hasPermission,type Action,type Role,type PermissionOverride} from './permissions';
// Screen visibility is derived from effective server permissions. APIs remain authoritative.
export const VIEW_RULES = {
 targets:{all:['company.read'],any:['accounts.manage']},home:{all:['company.read']},work:{all:['company.read']},search:{all:['company.read']},alerts:{all:['company.read']},
 projects:{all:['projects.read']}, inventory:{all:['projects.read','inventory.read'],project:true},
 pricing:{all:['projects.read','inventory.read','pricing.read'],project:true},
 import:{all:['projects.read','inventory.read','inventory.write'],project:true},
 plans:{all:['projects.read','inventory.read'],project:true},
 offers:{all:['leads.read','projects.read','inventory.read','pricing.read'],project:true},customers:{all:['leads.read']},pipeline:{all:['leads.read']},followups:{all:['leads.read']},
 'sales-teams':{all:['leads.read']},reports:{all:['reports.read']},'pipeline-reports':{all:['leads.read']},buyers:{all:['leads.read']},
 bookings:{all:['bookings.read']},contracts:{all:['bookings.read','finance.read']},
 collections:{all:['bookings.read','finance.read']},receipts:{all:['bookings.read','finance.read']},adjustments:{all:['bookings.read','finance.read']},
 'deals-insights':{all:['reports.read','finance.read'],project:true},commissions:{all:['commissions.read']},structure:{all:['company.read'],any:['company.write','members.manage','accounts.manage']},placements:{all:['company.read','members.manage']},
 team:{all:['company.read'],any:['accounts.manage','members.manage']},roles:{all:['company.read','roles.manage']},
 permissions:{all:['company.read','roles.manage']},settings:{all:['company.write']},stages:{all:['leads.read','leads.write'],roles:['company_admin','operations','sales_manager','sales_admin']}
} satisfies Record<string,{all:Action[];any?:Action[];project?:boolean;roles?:Role[]}>;
export type CompanyView=keyof typeof VIEW_RULES;
export const COMPANY_VIEWS=Object.keys(VIEW_RULES) as CompanyView[];
export function isCompanyView(value:unknown):value is CompanyView{return typeof value==='string'&&Object.hasOwn(VIEW_RULES,value);}
export function allowedCompanyViews(ctx:{owner?:boolean;role:Role;custom:Record<string,boolean>|null;overrides:PermissionOverride[]},projects:readonly string[]=[]):CompanyView[]{
 if(ctx.owner)return [...COMPANY_VIEWS];
 const permitted=(action:Action,project?:string)=>hasPermission(ctx.role,ctx.custom,ctx.overrides,action,project);
 return COMPANY_VIEWS.filter(view=>{
  const rule: {all:Action[];any?:Action[];project?:boolean;roles?:Role[]}=VIEW_RULES[view];
  if(rule.roles&&!rule.roles.includes(ctx.role))return false;
  if(!rule.all.every(a=>permitted(a))||rule.any&&!rule.any.some(a=>permitted(a)))return false;
  return !rule.project||!projects.length||projects.some(id=>rule.all.every(a=>permitted(a,id)));
 });
}
export function resolveCompanyView(requested:unknown,allowed:readonly CompanyView[]):CompanyView|null{
 return isCompanyView(requested)&&allowed.includes(requested)?requested:allowed[0]||null;
}
