'use client';
import {useState} from 'react';

export type FloorplanUnit = {
 id:string;code:string;status:string;area:string;
 approved_price_minor?:string|null;pricing_currency?:string|null;
 svg_coordinates?:unknown;
};
type Polygon={points:string;cx:number;cy:number};
const palette:Record<string,string>={
 available:'#58bd89',unavailable:'#aeb9bb',pending:'#f2cc63',
 reserved:'#ed9851',sold:'#9eacb5'
};
/** Parse only numeric geometry, never render user-supplied SVG markup. */
function parseGeometry(value:unknown):Polygon|null {
 const data=value&&typeof value==='object'&&!Array.isArray(value)
  ?(value as {points?:unknown}):null;
 const raw=data?.points;
 if(!Array.isArray(raw)||raw.length<3||raw.length>64)return null;
 const coords:number[][]=[];
 for(const point of raw){
  if(!Array.isArray(point)||point.length!==2||
    point.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>800))return null;
  coords.push(point);
 }
 // Approved BUNYRA polygons use normalized 0..1 points; legacy SVG data uses pixels.
 const normalized=coords.every(([x,y])=>x<=1&&y<=1);
 const translated=coords.map(([x,y])=>normalized?[Math.round(24+x*637),Math.round(30+y*440)]:[x,y]);
 return {points:translated.map(p=>p.join(',')).join(' '),
  cx:translated.reduce((s,p)=>s+p[0],0)/translated.length,
  cy:translated.reduce((s,p)=>s+p[1],0)/translated.length};
}
function amount(value:string|null|undefined){
 if(!value||!/^\d+$/.test(value))return '—';
 const n=BigInt(value);
 return (n/BigInt(100)).toString()+'.'+(n%BigInt(100)).toString().padStart(2,'0');
}
export default function FloorplanViewer({units,en,onBook}:{
 units:FloorplanUnit[];en:boolean;onBook:(unit:FloorplanUnit)=>void;
}){
 const [hover,setHover]=useState<string|null>(null);
 const tr=(ar:string,english:string)=>en?english:ar;
 const labels:Record<string,string>={
  available:tr('متاحة','Available'),unavailable:tr('غير متاحة','Unavailable'),
  pending:tr('قيد الحجز','Pending'),reserved:tr('محجوزة','Reserved'),sold:tr('مباعة','Sold')
 };
 const valid=units.map(unit=>({unit,polygon:parseGeometry(unit.svg_coordinates)}))
  .filter((x):x is {unit:FloorplanUnit;polygon:Polygon}=>x.polygon!==null);
 const active=valid.find(x=>x.unit.id===hover);
 return <section aria-label={tr('المخطط التفاعلي','Interactive floorplan')}>
  <div className="floorplan-legend">
   {Object.entries(labels).map(([status,label])=>
    <span key={status} className="floorplan-legend-item">
     <i aria-hidden="true" style={{background:palette[status]}}/>{label}
    </span>)}
  </div>
  <div className="floorplan-svg-shell">
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 685 515"
    role="img" aria-label={tr('مخطط وحدات فعلي','Real unit floorplan')}
    className="floorplan-svg">
    <rect x="24" y="30" width="637" height="440" rx="12" fill="#eaf0ed"
     stroke="#bbceca" strokeWidth="3"/>
    {valid.map(({unit,polygon})=>{
     const clickable=unit.status==='available';
     return <g key={unit.id} data-testid={'floorplan-unit-'+unit.code}
      role="button" tabIndex={clickable?0:-1}
      aria-label={unit.code+' - '+(labels[unit.status]??unit.status)}
      aria-disabled={!clickable}
      onMouseEnter={()=>setHover(unit.id)} onMouseLeave={()=>setHover(null)}
      onFocus={()=>setHover(unit.id)} onBlur={()=>setHover(null)}
      onClick={()=>{if(clickable)onBook(unit);}}
      onKeyDown={e=>{if(clickable&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onBook(unit);}}}
      style={{cursor:clickable?'pointer':'default'}}>
      <polygon points={polygon.points} fill={palette[unit.status]??'#aeb9bb'}
       stroke="#fff" strokeWidth={hover===unit.id?5:3} fillOpacity={hover===unit.id?1:0.85}/>
      <text x={polygon.cx} y={polygon.cy-2} textAnchor="middle" fontSize="17"
       fill="#123d32" fontWeight="bold" pointerEvents="none">{unit.code}</text>
      <text x={polygon.cx} y={polygon.cy+21} textAnchor="middle" fontSize="12"
       fill="#173a32" pointerEvents="none">{labels[unit.status]??unit.status}</text>
     </g>;
    })}
   </svg>
   {active&&<div role="tooltip" className="floorplan-info">
    <strong>{active.unit.code}</strong>
    <p>{active.unit.area} m² · {labels[active.unit.status]??active.unit.status}</p>
    <p dir="ltr">{amount(active.unit.approved_price_minor)} {active.unit.pricing_currency??''}</p>
   </div>}
  </div>
  {!valid.length&&<p className="muted">{tr(
   'لا توجد إحداثيات مخطط منشور لهذه الوحدات؛ المخطط لن يعرض وحدات افتراضية.',
   'No published geometry for these units; no placeholder floorplan is generated.'
  )}</p>}
  {valid.length<units.length&&<p className="muted">{tr(
   'بعض الوحدات لا تملك مخططًا معتمدًا؛ ستظل موجودة في جدول المخزون.',
   'Some units have no approved geometry; they remain in the inventory table.'
  )}</p>}
 </section>;
}
