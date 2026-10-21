'use client';
import {useEffect,useState} from 'react';
import {COMPANY_VIEWS,type CompanyView} from '../lib/bunyra/workspace-navigation';
export type {CompanyView} from '../lib/bunyra/workspace-navigation';
import {FolderKanban,Users,Receipt,Settings2,Building2,ChevronDown,Menu,X,LayoutDashboard} from 'lucide-react';
export const moduleGroups=[
 {id:'workspace',ar:'مساحة العمل',en:'Workspace',Icon:LayoutDashboard,items:[['home','الرئيسية','Home'],['work','مهامي','My work'],['search','البحث الموحد','Global search']]},
 {id:'projects',ar:'المشروعات والوحدات',en:'Projects & inventory',Icon:FolderKanban,items:[['projects','المشروعات','Projects'],['inventory','الوحدات','Units'],['pricing','التسعير والسداد','Pricing & payment plans'],['import','استيراد Excel','Excel import'],['plans','المخططات','Plans']]},
 {id:'sales',ar:'العملاء والمبيعات',en:'Customers & sales',Icon:Users,items:[['customers','العملاء والفرص','Customers & leads'],['pipeline','مسار البيع','Sales pipeline'],['followups','المتابعات','Follow-ups'],['sales-teams','فرق المبيعات','Sales teams'],['reports','تقارير المبيعات والأداء','Sales & performance reports'],['pipeline-reports','تحليل فرص البيع','Lead analytics'],['deals-insights','تحليل الصفقات والتحصيل','Deals & collections insights'],['buyers','طلبات العملاء','Buyer requests'],['offers','سجل العروض','Saved offers']]},
 {id:'commercial',ar:'الحجوزات والمالية',en:'Bookings & finance',Icon:Receipt,items:[['bookings','الحجوزات','Bookings'],['contracts','العقود','Contracts'],['collections','الأقساط والتحصيلات','Installments & collections'],['receipts','الإيصالات','Receipts'],['adjustments','التسويات والمرتجعات','Adjustments & refunds'],['commissions','العمولات','Commissions']]},
 {id:'organization',ar:'الإدارة',en:'Administration',Icon:Building2,items:[['structure','الهيكل الإداري','Organization'],['placements','ارتباطات الموظفين','Staff assignments'],['team','حسابات الشركة','Company accounts'],['roles','الأدوار والصلاحيات','Roles & permissions'],['permissions','صلاحيات المستخدمين','User permissions']]},
 {id:'settings',ar:'الإعدادات',en:'Settings',Icon:Settings2,items:[['settings','إعدادات الشركة','Company settings'],['stages','مراحل البيع','Sales stages']]}
] as const;

export function moduleLabel(view:CompanyView,en:boolean){const item=moduleGroups.flatMap(g=>[...g.items]).find(i=>i[0]===view);return item?.[en?2:1]||'';}
export default function CompanyNavigation({view,onChange,en,allowedViews=COMPANY_VIEWS}:{view:CompanyView;onChange:(view:CompanyView)=>void;en:boolean;allowedViews?:readonly CompanyView[]}){
 const [expanded,setExpanded]=useState<string>(()=>moduleGroups.find(g=>g.items.some(i=>i[0]===view))?.id||'projects'),[mobile,setMobile]=useState(false);
 useEffect(()=>{setExpanded(moduleGroups.find(g=>g.items.some(i=>i[0]===view))?.id||'projects');},[view]);
 return <div className={'company-navigation'+(mobile?' is-open':'')}><button className="module-menu-toggle" aria-expanded={mobile} onClick={()=>setMobile(!mobile)}>{mobile?<X size={18}/>:<Menu size={18}/>}<span>{moduleLabel(view,en)}</span></button><nav aria-label={en?'Company sections':'أقسام الشركة'}>{moduleGroups.filter(g=>g.items.some(i=>allowedViews.includes(i[0]))).map(g=>{const active=g.items.some(i=>i[0]===view),open=expanded===g.id;return <div className="module-group" key={g.id}><button className={'module-parent'+(active?' active':'')} aria-expanded={open} title={en?g.en:g.ar} onClick={()=>setExpanded(open?'':g.id)}><g.Icon size={18}/><span>{en?g.en:g.ar}</span><ChevronDown size={14} className={open?'rotated':''}/></button>{open&&<div className="module-children">{g.items.filter(i=>allowedViews.includes(i[0])).map(i=><button key={i[0]} aria-current={view===i[0]?'page':undefined} className={view===i[0]?'selected':''} onClick={()=>{onChange(i[0]);setMobile(false);window.scrollTo({top:0,behavior:'instant'});}}>{i[en?2:1]}</button>)}</div>}</div>})}</nav></div>;
}
