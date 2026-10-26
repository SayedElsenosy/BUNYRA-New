import {redirect} from 'next/navigation';
// BUNYRA currently renders the inventory module inside the company workspace.
// Keep a stable /inventory entrypoint without forking its auth or UI.
export default async function InventoryPage({searchParams}:{
 searchParams:Promise<{company?:string}>
}){
 const {company}=await searchParams;
 const query=new URLSearchParams({view:'inventory'});
 if(company&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(company))query.set('company',company);
 redirect('/?'+query.toString());
}
