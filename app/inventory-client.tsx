'use client';
import {useWorkspaceLocation} from './workspace-location';
import FloorplanViewer,{type FloorplanUnit} from './FloorplanViewer';

/** Reuses the real BUNYRA inventory payload, not mock NextAuth-era records. */
export default function InventoryClient({companyId,projectId,units,en}:{
 companyId:string;projectId:string;units:FloorplanUnit[];en:boolean;
}){
 const [,navigate]=useWorkspaceLocation();
 function book(unit:FloorplanUnit){
  if(unit.status!=='available')return;
  // Existing /api/commercial action 'booking' always authenticates with
  // BUNYRA's Neon Auth/managed session and checks tenant/project permissions.
  navigate({company:companyId,view:'bookings',record:projectId,
   entity:unit.id,action:'book_unit',page:''});
 }
 return <div className="inventory-floorplan-panel">
  <div className="inventory-floorplan-header">
   <strong>{en?'Interactive unit map':'مخطط الوحدات التفاعلي'}</strong>
   <span className="muted">{en?'Published geometry only':'المخططات المنشورة فقط'}</span>
  </div>
  <FloorplanViewer units={units} en={en} onBook={book}/>
 </div>;
}
