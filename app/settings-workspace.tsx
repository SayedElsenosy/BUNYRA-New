'use client';
import type {ReactNode} from 'react';
import {Settings2,Users,ShieldCheck,GitBranch,Target,Building2,LockKeyhole} from 'lucide-react';
import {useWorkspaceLocation} from './workspace-location';
import type {CompanyView} from './company-navigation';
const items:{view:CompanyView;ar:string;en:string;Icon:typeof Settings2}[]=[
 {view:'settings',ar:'الإعدادات العامة',en:'General',Icon:Settings2},
 {view:'team',ar:'الفريق والحسابات',en:'Team & accounts',Icon:Users},
 {view:'targets',ar:'أهداف المبيعات',en:'Sales targets',Icon:Target},
 {view:'roles',ar:'الأدوار والصلاحيات',en:'Roles & permissions',Icon:ShieldCheck},
 {view:'permissions',ar:'صلاحيات المستخدمين',en:'Member permissions',Icon:LockKeyhole},
 {view:'sales-teams',ar:'الفرق وتوزيع العملاء المحتملين',en:'Teams & lead routing',Icon:Users},
 {view:'stages',ar:'مراحل البيع',en:'Sales stages',Icon:GitBranch},
 {view:'structure',ar:'الهيكل الإداري',en:'Organization',Icon:Building2},
 {view:'placements',ar:'ارتباطات الموظفين',en:'Staff assignments',Icon:Users}
];
export const SETTINGS_VIEWS=items.map(i=>i.view);
export default function SettingsWorkspace({view,companyId,en,allowedViews,asOwner,children}:{view:CompanyView;companyId:string;en:boolean;allowedViews?:readonly CompanyView[];asOwner:boolean;children:ReactNode}){
 const [,navigate]=useWorkspaceLocation(),t=(a:string,e:string)=>en?e:a;
 return <div className="settings-workspace"><aside className="settings-nav" aria-label={t('قائمة الإعدادات','Settings navigation')}><span className="eyebrow">{t('إدارة الشركة','COMPANY ADMINISTRATION')}</span>{items.filter(i=>!allowedViews||allowedViews.includes(i.view)).map(i=><button key={i.view} className={view===i.view?'selected':''} aria-current={view===i.view?'page':undefined} onClick={()=>navigate({company:companyId,view:i.view,record:'',action:'',page:''})}><i.Icon size={17}/>{en?i.en:i.ar}</button>)}<div className="settings-owner-note"><LockKeyhole size={18}/><strong>{t('إدارة المنصة','Platform administration')}</strong><p>{t('الباقات وحدود الحسابات وإعدادات الاستضافة والتكاملات المركزية يديرها مالك المنصة.','Packages, seat limits, hosting and central integrations are managed by the platform owner.')}</p>{asOwner&&<p>{t('أنت تدير هذه الشركة بصلاحية مالك المنصة.','You are managing this company as platform owner.')}</p>}</div></aside><div className="settings-content">{children}</div></div>;
}
