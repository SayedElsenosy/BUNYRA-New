'use client';
import {useEffect,useState} from 'react';
import ProjectWizard from './project-wizard';
import InventoryPanel from './inventory-panel';
import OrganizationPanel from './organization-panel';
import TeamPanel from './team-panel';
import CrmPanel from './crm-panel';
import CommercialPanel from './commercial-panel';
import SalesPipelinePanel from './sales-pipeline-panel';
import BuyerRequestPanel from './buyer-request-panel';
import {moduleLabel,type CompanyView} from './company-navigation';
function ModuleScreen({companyId,en,onChanged,view='projects',asOwner=false}:{companyId:string;en:boolean;onChanged?:()=>void;view?:CompanyView;asOwner?:boolean}){
 const props={companyId,en,asOwner};
 return <section className="company-module-workspace" aria-label={moduleLabel(view,en)}><h2 className="module-title">{moduleLabel(view,en)}</h2>{
 view==='projects'?<ProjectWizard {...props} onChanged={onChanged}/>:
 ['inventory','pricing','import','plans'].includes(view)?<InventoryPanel {...props} section={view as 'inventory'|'pricing'|'import'|'plans'}/>:
 view==='customers'?<CrmPanel {...props}/>:
 ['pipeline','followups','sales-teams','reports','stages'].includes(view)?<SalesPipelinePanel {...props} section={view as 'pipeline'|'followups'|'sales-teams'|'reports'|'stages'}/>:
 view==='buyers'?<BuyerRequestPanel {...props}/>:
 ['bookings','contracts','collections','receipts','adjustments'].includes(view)?<CommercialPanel {...props} section={view as 'bookings'|'contracts'|'collections'|'receipts'|'adjustments'}/>:
 ['team','roles','permissions'].includes(view)?<TeamPanel {...props} section={view as 'team'|'roles'|'permissions'}/>:
 <OrganizationPanel {...props} section={view as 'settings'|'structure'|'placements'} onCompanyChanged={onChanged}/>
 }</section>;
}

export default function CompanyWorkspace(props:Parameters<typeof ModuleScreen>[0]){
 const view=props.view||'projects';
 const [visited,setVisited]=useState<CompanyView[]>([view]);
 useEffect(()=>{setVisited(previous=>previous.includes(view)?previous:[...previous,view]);},[view]);
 return <div className="company-screens">{visited.map(screen=><div key={screen} style={{display:screen===view?'block':'none'}} aria-hidden={screen!==view}><ModuleScreen {...props} view={screen}/></div>)}</div>;
}
