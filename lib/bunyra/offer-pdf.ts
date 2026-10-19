import {offerLogo} from './offer-logo';
import {jsPDF} from 'jspdf';
import {amiriBase64} from './offer-font';
import {majorAmount} from './pricing-calculator';
type Offer={
 company:{name:string;name_en?:string;phone?:string;email?:string;address?:string};
 project:{name:string};unit:{code:string;building:string;floor:string;category:string;area:string};
 customer?:{full_name:string;phone:string;email?:string;address?:string}|null;
 quote:{book?:{currency?:string}|null;plan:{name:string;code:string;down_payment_bps:number;installments:number;interval_months:number};calculation:{total_minor:string;down_payment_minor:string;installments:Array<{number:number;due_date:string;amount_minor:string}>}};
 salesperson:{name:string;email:string;phone?:string};language?:'ar'|'en';
};
export function renderOfferPdf(data:Offer){
 const doc=new jsPDF({unit:'pt',format:'a4',compress:true}),ar=data.language!=='en',currency=data.quote.book?.currency||'EGP',width=595.28,margin=42,bottom=782;
 doc.addFileToVFS('Amiri-Regular.ttf',amiriBase64);doc.addFont('Amiri-Regular.ttf','Amiri','normal');doc.setFont('Amiri');
 doc.setProperties({title:ar?'عرض سعر':'Property offer',author:data.company.name,subject:data.unit.code});
 const t=(a:string,e:string)=>ar?a:e;let y=0,page=0;
 function header(){page++;doc.setFillColor(16,34,58);doc.rect(0,0,width,78,'F');doc.setTextColor(226,185,121);doc.setFontSize(20);doc.addImage(offerLogo,'PNG',margin,16,170,46);doc.setTextColor(255,255,255);doc.setFontSize(18);doc.text(t('عرض سعر','PROPERTY OFFER'),width-margin,42,{align:'right',isInputVisual:false,isOutputVisual:true,isInputRtl:ar,isOutputRtl:false});doc.setTextColor(22,38,59);y=105;}
 function footer(){doc.setDrawColor(229,233,239);doc.line(margin,805,width-margin,805);doc.setFontSize(9);doc.setTextColor(116,129,148);doc.text(String(page),width/2,823,{align:'center'});}
 function newPage(){footer();doc.addPage();header();}
 function text(value:string,size=12,bold=false){doc.setFontSize(size);doc.setTextColor(bold?155:22,bold?114:38,bold?62:59);const lines=doc.splitTextToSize(value,width-margin*2) as string[];for(const line of lines){if(y+22>bottom)newPage();doc.text(line,ar?width-margin:margin,y,{align:ar?'right':'left',isInputVisual:false,isOutputVisual:true,isInputRtl:ar,isOutputRtl:false});y+=21;} }
 function field(a:string,e:string,value:unknown){text(t(a,e)+': '+String(value||'—'));}
 header();text(ar?data.company.name:(data.company.name_en||data.company.name),19,true);field('المشروع','Project',data.project.name);field('العميل','Customer',data.customer?.full_name);field('الهاتف','Phone',data.customer?.phone);y+=8;text(t('بيانات الوحدة','UNIT DETAILS'),15,true);
 field('كود الوحدة','Unit code',data.unit.code);field('المبنى / الدور','Building / floor',data.unit.building+' / '+data.unit.floor);field('التصنيف','Category',data.unit.category);field('المساحة م²','Area sqm',data.unit.area);y+=8;text(t('السعر المعتمد ونظام السداد','APPROVED PRICE & PAYMENT PLAN'),15,true);
 field('نظام السداد','Payment plan',data.quote.plan.name+' · '+data.quote.plan.code);field('السعر الإجمالي','Total price',majorAmount(data.quote.calculation.total_minor)+' '+currency);field('المقدم','Down payment',majorAmount(data.quote.calculation.down_payment_minor)+' '+currency);y+=9;
 for(const i of data.quote.calculation.installments){if(y+32>bottom)newPage();doc.setFillColor(i.number%2?248:255,i.number%2?250:255,i.number%2?252:255);doc.rect(margin,y-15,width-margin*2,25,'F');doc.setFontSize(11);doc.setTextColor(22,38,59);doc.text(t('القسط','Installment')+' '+i.number,width-margin-8,y,{align:'right',isInputVisual:false,isOutputVisual:true,isInputRtl:ar,isOutputRtl:false});doc.text(i.due_date,width/2,y,{align:'center',isInputVisual:false,isOutputVisual:true,isInputRtl:false,isOutputRtl:false});doc.text(majorAmount(i.amount_minor)+' '+currency,margin+8,y,{isInputVisual:false,isOutputVisual:true,isInputRtl:false,isOutputRtl:false});y+=25;}
 y+=15;text(t('بيانات التواصل','CONTACT DETAILS'),15,true);field('المندوب','Representative',data.salesperson.name);field('هاتف المندوب','Representative phone',data.salesperson.phone||data.company.phone);field('البريد','Email',data.salesperson.email||data.company.email);
 text(t('هذا عرض استرشادي ولا يُعد حجزًا أو بيعًا أو عقدًا.','This offer is informational and is not a booking, sale or contract.'),10);footer();return new Uint8Array(doc.output('arraybuffer'));
}
