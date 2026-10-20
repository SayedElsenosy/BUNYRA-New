'use client';
import {useEffect,useState} from 'react';
export type WorkspaceLocation={company:string;view:string;tab:string;q:string;bucket:string;page:string;entity:string;record:string;action:string};
const empty:WorkspaceLocation={company:'',view:'',tab:'',q:'',bucket:'',page:'',entity:'',record:'',action:''};
function snapshot():WorkspaceLocation{const p=new URLSearchParams(window.location.search);return {company:p.get('company')||'',view:p.get('view')||'',tab:p.get('tab')||'',q:p.get('q')||'',bucket:p.get('bucket')||'',page:p.get('page')||'',entity:p.get('entity')||'',record:p.get('record')||'',action:p.get('action')||''};}
export function useWorkspaceLocation(){
 const [location,setLocation]=useState<WorkspaceLocation>(empty);
 useEffect(()=>{const sync=()=>setLocation(snapshot());sync();window.addEventListener('popstate',sync);window.addEventListener('bunyra:navigation',sync);return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('bunyra:navigation',sync);};},[]);
 function navigate(patch:Partial<WorkspaceLocation>,replace=false){
  const url=new URL(window.location.href);
  for(const [key,value] of Object.entries(patch))if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);
  if(url.href!==window.location.href)window.history[replace?'replaceState':'pushState'](null,'',url.pathname+url.search+url.hash);
  window.dispatchEvent(new Event('bunyra:navigation'));
 }
 return [location,navigate] as const;
}
