'use client';
import {useState} from 'react';
import ProjectWizard from './project-wizard';
import InventoryPanel from './inventory-panel';
import OrganizationPanel from './organization-panel';
import TeamPanel from './team-panel';
import CrmPanel from './crm-panel';
import CommercialPanel from './commercial-panel';
export default function CompanyWorkspace({companyId,en,onChanged}:{companyId:string;en:boolean;onChanged:()=>void}){
 const [view,setView]=useState('projects'),[revision,setRevision]=useState(0),t=(a:string,e:string)=>en?e:a;
 const items=[['projects',t('المشروعات والمخططات','Projects & plans')],['crm',t('العملاء والمبيعات','Customers & sales')],['commercial',t('الحجوزات والعقود','Bookings & contracts')],['organization',t('الهيكل الإداري','Organization')],['team',t('الحسابات والصلاحيات','Accounts & permissions')]];
 return <section className="company-module-workspace"><nav className="tabs" aria-label={t('وحدات الشركة','Company modules')}>{items.map(([id,label])=><button key={id} className={view===id?'current':''} onClick={()=>setView(id)}>{label}</button>)}</nav>{view==='projects'?<><ProjectWizard companyId={companyId} en={en} asOwner onChanged={()=>{setRevision(r=>r+1);onChanged()}}/><InventoryPanel key={revision} companyId={companyId} en={en} asOwner/></>:view==='crm'?<CrmPanel companyId={companyId} en={en} asOwner/>:view==='commercial'?<CommercialPanel companyId={companyId} en={en} asOwner/>:view==='organization'?<OrganizationPanel companyId={companyId} en={en} asOwner onCompanyChanged={onChanged}/>:<TeamPanel companyId={companyId} en={en} asOwner/>}</section>;
}
