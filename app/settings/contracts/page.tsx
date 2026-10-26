import Link from "next/link";
import {identity} from "../../../lib/bunyra/http";
import {activeWordTemplate} from "../../../lib/bunyra/word-templates";
import {uuid} from "../../../lib/bunyra/service";
import ContractTemplateManager from "../../contract-template-manager";
export const dynamic="force-dynamic";
export default async function ContractTemplateSettings({searchParams}:{searchParams:Promise<{company?:string;mode?:string}>}){
 const p=await searchParams,company=uuid.parse(p.company),platform=p.mode==="platform";
 const {sql,actor}=await identity();
 const current=await activeWordTemplate(sql,actor,company,platform);
 // Metadata only; never expose S3 keys or raw customer data in the UI.
 const view=current?{id:String(current.id),name:String(current.name),file_name:String(current.original_name),
  file_size:Number(current.file_size)}:null;
 return <main className="panel" style={{maxWidth:950,margin:"2rem auto",padding:25}}>
  <Link href={platform?"/owner":"/company"}>← العودة إلى BUNYRA</Link>
  <h1>إعدادات قوالب العقود (Word)</h1>
  <p>ارفع قالب DOCX للشركة. الحجم الأقصى 5MB، ويُطبّق تلقائيًا على العقود التابعة لها فقط.</p>
  <ContractTemplateManager company={company} platform={platform} initial={view}/>
 </main>;
}
