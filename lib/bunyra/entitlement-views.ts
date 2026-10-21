export type PackageFeature='crm'|'inventory'|'floorplans'|'buyer_matching'|'advanced_reports'|'commissions'|'finance_erp'|'whatsapp';
/** Screen-level feature gating: UI convenience, not an authorization boundary.
 * Real API endpoints always use requireEntitled() after authenticated access(). */
/** Presentational screen filtering only; /api services MUST use requireEntitled.
 * Collections/contracts are core CRM workflow, not the future finance_erp add-on. */
export const VIEW_ENTITLEMENTS:Partial<Record<string,PackageFeature>>={
 targets:'crm',customers:'crm',pipeline:'crm',followups:'crm','sales-teams':'crm',stages:'crm',
 inventory:'inventory',import:'inventory',pricing:'inventory',
 plans:'floorplans',buyers:'buyer_matching',
 commissions:'commissions',reports:'advanced_reports','deals-insights':'advanced_reports'
};
export function subscriptionAllowedViews(views:readonly string[],subscription:null|{status:string;features?:Partial<Record<PackageFeature,boolean>>}){
 if(!subscription)return [...views]; // preserve legacy company behaviour
 if(subscription.status==='suspended')return [];
 return views.filter(v=>{
  const feature=VIEW_ENTITLEMENTS[v];
  return !feature||subscription.features?.[feature]===true;
 });
}

