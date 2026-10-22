import fs from 'node:fs';import assert from 'node:assert/strict';import ts from 'typescript';
const directory='.sites-runtime/navigation-tests';fs.mkdirSync(directory,{recursive:true});
for(const name of ['permissions','workspace-navigation']){const source=fs.readFileSync('lib/bunyra/'+name+'.ts','utf8');fs.writeFileSync(directory+'/'+name+'.mjs',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll("from './permissions'","from './permissions.mjs'"));}
const {allowedCompanyViews,resolveCompanyView,COMPANY_VIEWS,isCompanyView}=await import('../'+directory+'/workspace-navigation.mjs');
const ctx=(role,custom=null,overrides=[])=>({role,custom,overrides});const results=[];
const test=(name,fn)=>{fn();results.push({name,passed:true});};
const sales=allowedCompanyViews(ctx('sales'));
test('Every company member with company.read sees alerts but no hidden data',()=>{
 const v=allowedCompanyViews(ctx('sales'));assert.ok(v.includes('alerts'));
 assert.ok(!allowedCompanyViews(ctx('sales',{'leads.read':true})).includes('alerts'));
});
test('Sales can access customer and booking screens',()=>assert.ok(['customers','followups','inventory','bookings','reports','commissions'].every(v=>sales.includes(v))));
test('Sales cannot access company administration or finance screens',()=>assert.ok(['team','roles','permissions','settings','placements','import','collections','receipts','contracts','structure','stages'].every(v=>!sales.includes(v))));
const finance=allowedCompanyViews(ctx('accountant'));
test('Accountants see collection and receipt work',()=>assert.ok(['collections','receipts','adjustments','contracts'].every(v=>finance.includes(v))));
test('Finance ledgers require finance manager or company administrator, never sales or scoped accountants',()=>{
 const views=['ledger','vendor-payables','fixed-assets','treasury','accounting-reports'];
 for(const view of views){
  assert.ok(allowedCompanyViews(ctx('finance_manager')).includes(view));
  assert.ok(allowedCompanyViews(ctx('company_admin')).includes(view));
  assert.ok(!allowedCompanyViews(ctx('accountant')).includes(view));
  assert.ok(!sales.includes(view));
 }
});
test('Accountants cannot enter sales or inventory screens',()=>assert.ok(['customers','buyers','inventory','import','pricing'].every(v=>!finance.includes(v))));
test('Operations can manage accounts without editing roles',()=>{const v=allowedCompanyViews(ctx('operations'));assert.ok(v.includes('team'));assert.ok(!v.includes('roles')&&!v.includes('permissions'));});
test('Admin has every screen',()=>assert.deepEqual(allowedCompanyViews(ctx('company_admin')),COMPANY_VIEWS.filter(v=>!['pipeline','pipeline-reports'].includes(v))));
test('Verified owner retains all screens',()=>assert.deepEqual(allowedCompanyViews({...ctx('sales',{}),owner:true}),COMPANY_VIEWS.filter(v=>!['pipeline','pipeline-reports'].includes(v))));
test('Custom roles never inherit base-role privileges',()=>assert.deepEqual(allowedCompanyViews(ctx('company_admin',{})),[]));
test('Minimal custom role only sees its own CRM screens',()=>{const v=allowedCompanyViews(ctx('sales',{'leads.read':true}));assert.ok(v.includes('customers'));assert.ok(!v.includes('reports')&&!v.includes('stages')&&!v.includes('projects'));});
test('Company deny removes administration even for built-in admin',()=>assert.ok(!allowedCompanyViews(ctx('company_admin',null,[{action:'roles.manage',project_id:null,allowed:false}])).includes('roles')));
test('Deny all project inventory access hides inventory and pricing',()=>{const v=allowedCompanyViews(ctx('sales',null,[{action:'inventory.read',project_id:'p1',allowed:false},{action:'inventory.read',project_id:'p2',allowed:false}]),['p1','p2']);assert.ok(!v.includes('inventory')&&!v.includes('pricing'));});
test('A permitted project keeps inventory visible',()=>assert.ok(allowedCompanyViews(ctx('sales',null,[{action:'inventory.read',project_id:'p1',allowed:false}]),['p1','p2']).includes('inventory')));
test('Required permissions must apply to the same project',()=>{const v=allowedCompanyViews(ctx('sales',null,[{action:'inventory.read',project_id:'p1',allowed:false},{action:'pricing.read',project_id:'p2',allowed:false}]),['p1','p2']);assert.ok(v.includes('inventory')&&!v.includes('pricing'));});
test('Project grant cannot bypass API company-level requirement',()=>assert.ok(!allowedCompanyViews(ctx('sales',{'projects.read':true},[{action:'inventory.read',project_id:'p1',allowed:true}]),['p1']).includes('inventory')));
test('Unknown view falls back to an authorized screen',()=>assert.equal(resolveCompanyView('evil',sales),sales[0]));
test('Forbidden direct URL falls back to an authorized screen',()=>assert.equal(resolveCompanyView('collections',sales),sales[0]));
test('Empty grants produce no mounted screen',()=>assert.equal(resolveCompanyView('projects',[]),null));
test('Valid deep link remains selected',()=>assert.equal(resolveCompanyView('followups',sales),'followups'));
test('Prototype properties are never valid views',()=>assert.equal(isCompanyView('__proto__'),false));
test('Executable URL text is never accepted as a view',()=>assert.equal(isCompanyView('javascript:alert(1)'),false));
test('Only the customer directory remains and deprecated pipeline URLs resolve to it',()=>{
 assert.ok(sales.includes('customers'));
 assert.ok(!sales.includes('pipeline')&&!sales.includes('pipeline-reports'));
 assert.equal(resolveCompanyView('pipeline',sales),'customers');
 assert.equal(resolveCompanyView('pipeline-reports',sales),'customers');
});
test('Sales can open saved offer history',()=>assert.ok(sales.includes('offers')));
test('Deals insights needs finance and reports permissions, not just sales reports',()=>{
 const salesView=allowedCompanyViews(ctx('sales'));
 assert.ok(!salesView.includes('deals-insights'));
 assert.ok(allowedCompanyViews(ctx('finance_manager')).includes('deals-insights'));
 assert.ok(allowedCompanyViews(ctx('company_admin')).includes('deals-insights'));
 assert.ok(!allowedCompanyViews(ctx('company_admin',null,[{action:'finance.read',project_id:null,allowed:false}])).includes('deals-insights'));
});
test('Finance project deny hides deals insights when all projects denied',()=>{
 const v=allowedCompanyViews(ctx('finance_manager',null,[{action:'finance.read',project_id:'p1',allowed:false}]),['p1']);
 assert.ok(!v.includes('deals-insights'));
});
test('Finance-only and CRM-only roles cannot open saved offers',()=>{assert.ok(!finance.includes('offers'));assert.ok(!allowedCompanyViews(ctx('sales',{'leads.read':true})).includes('offers'));});
test('Project price denials hide saved offers when all projects are denied',()=>{const v=allowedCompanyViews(ctx('sales',null,[{action:'pricing.read',project_id:'p1',allowed:false}]),['p1']);assert.ok(!v.includes('offers'));});
test('accountants cannot inherit all financial projects by default',()=>{
 const a=allowedCompanyViews(ctx('accountant'),['p1','p2']);
 assert.ok(['projects','reports','bookings','contracts','collections','receipts','adjustments','commissions','deals-insights'].every(x=>!a.includes(x)));
});
test('an explicit project grant enables only granted financial screens',()=>{
 const o=['projects.read','bookings.read','finance.read','finance.write','commissions.read','commissions.pay','reports.read'].filter(x=>x!=='commissions.read'&&x!=='commissions.pay').map(action=>({action,project_id:'p1',allowed:true}));
 const a=allowedCompanyViews(ctx('accountant',null,o),['p1','p2']);
 assert.ok(['projects','reports','bookings','contracts','collections','receipts','adjustments'].every(x=>a.includes(x)));
 assert.ok(!a.includes('commissions'));
});
test('explicit company denial wins over accountant project grant',()=>{
 const o=[{action:'finance.read',project_id:'p1',allowed:true},{action:'finance.read',project_id:null,allowed:false}];
 const a=allowedCompanyViews(ctx('accountant',null,o),['p1']);
 assert.ok(!a.includes('collections'));
});
test('a custom accountant role needs its own project and action grants',()=>{
 const o=[{action:'finance.read',project_id:'p1',allowed:true},{action:'bookings.read',project_id:'p1',allowed:true}];
 assert.ok(!allowedCompanyViews(ctx('accountant',{},o),['p1']).includes('collections'));
});
test('finance managers continue to see all permitted project screens',()=>{
 const a=allowedCompanyViews(ctx('finance_manager'),['p1','p2']);
 assert.ok(['bookings','contracts','collections','receipts','adjustments','commissions'].every(x=>a.includes(x)));
});
console.log(JSON.stringify({passed:results.length,results},null,2));
