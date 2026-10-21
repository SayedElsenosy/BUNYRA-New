import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const out='.sites-runtime/navigation-tests';
fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync('lib/bunyra/entitlement-views.ts','utf8');
fs.writeFileSync(path.join(out,'entitlement-views.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
const {subscriptionAllowedViews,VIEW_ENTITLEMENTS}=await import('../'+out+'/entitlement-views.mjs');
const examples=['home','customers','pipeline','buyers','inventory','plans','commissions','reports','deals-insights','collections'];
const plans=(features,status='active')=>({features,status});
assert.deepEqual(subscriptionAllowedViews(examples,null),examples,'Legacy company access unchanged');
assert.deepEqual(subscriptionAllowedViews(examples,plans({})),['home','collections'],'Disabled features hidden by default');
assert.deepEqual(subscriptionAllowedViews(examples,plans({crm:true})),['home','customers','pipeline','collections']);
assert.deepEqual(subscriptionAllowedViews(examples,plans({inventory:true,floorplans:false,commissions:true})),['home','inventory','commissions','collections']);
assert.deepEqual(subscriptionAllowedViews(examples,plans({advanced_reports:true,buyer_matching:true})),['home','buyers','reports','deals-insights','collections']);
assert.deepEqual(subscriptionAllowedViews(examples,plans({crm:true,inventory:true,advanced_reports:true},'suspended')),[],'Suspended UI unavailable');
for(const [view,feature] of Object.entries(VIEW_ENTITLEMENTS))assert.ok(feature&&typeof view==='string');
const routes=[
 ['app/api/buyer/route.ts','buyer_matching'],
 ['app/api/commissions/route.ts','commissions'],
 ['app/api/plan-layout/route.ts','floorplans'],
 ['app/api/plan-files/route.ts','floorplans'],
 ['app/api/plan-files/upload/route.ts','floorplans'],
 ['app/api/inventory/route.ts','inventory'],
 ['app/api/inventory/import/route.ts','inventory'],
 ['app/api/unit-transformations/route.ts','inventory'],
 ['app/api/pricing/route.ts','inventory'],
 ['app/api/crm/route.ts','crm'],
 ['app/api/sales/route.ts','crm'],
 ['app/api/follow-ups/route.ts','crm'],
 ['app/api/lead-routing/route.ts','crm'],
 ['app/api/customer-journey/route.ts','crm'],
 ['app/api/offers/route.ts','crm']
];
const service=fs.readFileSync('lib/bunyra/subscriptions.ts','utf8');
assert.match(service,/await access\(sql,actor,company,'company.read',platform\)/,'Owner bypass requires verified access()');
assert.match(service,/await requireFeature\(sql,company,feature,platform\)/);
for(const [route,feature] of routes){
 const body=fs.readFileSync(route,'utf8');
 assert.ok(body.includes('requireEntitled'),route+' must use verified entitlement gate');
 assert.ok(body.includes("'"+feature+"'"),route+' must verify the expected feature');
}
console.log(JSON.stringify({passed:7+routes.length,checked_routes:routes.length},null,2));
