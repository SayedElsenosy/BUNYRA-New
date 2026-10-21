'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
export default function WorkspaceDrawer({title,onClose,children,wide=false,busy=false,en=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean;busy?:boolean;en?:boolean}){
 const ref=useRef<HTMLElement>(null);
 const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  const prior=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.focus();
  return()=>{document.body.style.overflow=overflow;prior?.focus();};
 },[]);
 return createPortal(<div className="workspace-drawer-backdrop" onClick={()=>!busy&&close.current()}><section ref={ref} tabIndex={-1} className={'workspace-drawer'+(wide?' wide':'')} role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()} onKeyDown={e=>{
  if(e.key==='Escape'){e.stopPropagation();if(!busy)close.current();}
  if(e.key==='Tab'){const nodes=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')||[]).filter(n=>n.getClientRects().length);const first=nodes[0],last=nodes[nodes.length-1];if(!first){e.preventDefault();return;}if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){last.focus();e.preventDefault();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===ref.current)){first.focus();e.preventDefault();}}
 }}><header className="workspace-drawer-header"><div><span className="eyebrow">BUNYRA · {en?'WORKSPACE':'مساحة العمل'}</span><h2>{title}</h2></div><button type="button" className="icon-button" disabled={busy} aria-label={en?'Close panel':'إغلاق اللوحة'} onClick={()=>close.current()}><X size={20}/></button></header><div className="workspace-drawer-body">{children}</div></section></div>,document.body);
}
