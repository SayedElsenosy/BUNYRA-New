'use client';
import FollowUpsPanel from './follow-ups-panel';
import PipelineBoard from './pipeline-board';
import {useEffect,useState} from 'react';
import WorkspaceHubPanel from './workspace-hub-panel';
import {useWorkspaceLocation} from './workspace-location';
import {Search} from 'lucide-react';
import CommissionPanel from './commission-panel';
import SalesReportsPanel from './sales-reports-panel';
import ProjectWizard from './project-wizard';
import InventoryPanel from './inventory-panel';
import OrganizationPanel from './organization-panel';
import TeamPanel from './team-panel';
import SavedOffersPanel from './saved-offers-panel';
import CrmPanel from './crm-panel';
import CommercialPanel from './commercial-panel';
import SalesPipelinePanel from './sales-pipeline-panel';
import BuyerRequestPanel from './buyer-request-panel';
import {moduleLabel,type CompanyView} from './company-navigation';
function ModuleScreen({companyId,en,onChanged,view='home',asOwner=false,active=true}:{companyId:string;en:boolean;onChanged?:()=>void;view?:CompanyView;asOwner?:boolean;active?:boolean;allowedViews?:readonly CompanyView[]}){
 const props={companyId,en,asOwner};
 return <section className="company-module-workspace" aria-label={moduleLabel(view,en)}>{!['home','work','search'].includes(view)&&<h2 className="module-title">{moduleLabel(view,en)}</h2>}{
 ['home','work','search'].includes(view)?<WorkspaceHubPanel {...props} section={view as 'home'|'work'|'search'} active={active}/>:view==='commissions'?<CommissionPanel {...props} active={active}/>:view==='reports'?<SalesReportsPanel {...props} active={active}/>:view==='pipeline-reports'?<SalesPipelinePanel {...props} section="reports"/>:
 view==='projects'?<ProjectWizard {...props} onChanged={onChanged}/>:
 ['inventory','pricing','import','plans'].includes(view)?<InventoryPanel {...props} section={view as 'inventory'|'pricing'|'import'|'plans'}/>:
 view==='offers'?<SavedOffersPanel {...props} active={active}/>:view==='customers'?<CrmPanel {...props}/>:
 view==='followups'?<FollowUpsPanel {...props} active={active}/>:view==='pipeline'?<PipelineBoard {...props} active={active}/>:['pipeline','followups','sales-teams','reports','stages'].includes(view)?<SalesPipelinePanel {...props} section={view as 'pipeline'|'followups'|'sales-teams'|'reports'|'stages'}/>:
 view==='buyers'?<BuyerRequestPanel {...props}/>:
 ['bookings','contracts','collections','receipts','adjustments'].includes(view)?<CommercialPanel {...props} section={view as 'bookings'|'contracts'|'collections'|'receipts'|'adjustments'}/>:
 ['team','roles','permissions'].includes(view)?<TeamPanel {...props} section={view as 'team'|'roles'|'permissions'}/>:
 <OrganizationPanel {...props} section={view as 'settings'|'structure'|'placements'} onCompanyChanged={onChanged}/>
 }</section>;
}

export default function CompanyWorkspace(props:Parameters<typeof ModuleScreen>[0]){
 const view=props.view||'home';
 const [route,navigate]=useWorkspaceLocation();
 const launch=()=>navigate({company:props.companyId,view:'search',record:'',action:'',page:''});
 useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();launch();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[props.companyId]);
 const [visited,setVisited]=useState<CompanyView[]>([view]);
 useEffect(()=>{setVisited(previous=>previous.includes(view)?previous:[...previous,view]);},[view]);
 return <div className="company-screens">{!['home','work','search'].includes(view)&&<div className="hub-launcher"><button className="secondary" onClick={launch}><Search size={17}/>{props.en?'Search records':'بحث في السجلات'} <kbd>Ctrl K</kbd></button></div>}{visited.filter(screen=>!props.allowedViews||props.allowedViews.includes(screen)).map(screen=><div key={screen} style={{display:screen===view?'block':'none'}} aria-hidden={screen!==view}><ModuleScreen {...props} view={screen} active={screen===view}/></div>)}</div>;
}
