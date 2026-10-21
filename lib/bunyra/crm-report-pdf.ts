import {jsPDF} from 'jspdf';
import {amiriBase64} from './offer-font';
type Section={title:string;headers:string[];rows:string[][]};
export function renderCrmReportPdf({title,company,period,notes,sections,en=false}:{title:string;company:string;period:string;notes:string[];sections:Section[];en?:boolean}){
 const doc=new jsPDF({unit:'pt',format:'a4',compress:true});
 doc.addFileToVFS('Amiri-Regular.ttf',amiriBase64);doc.addFont('Amiri-Regular.ttf','Amiri','normal');doc.setFont('Amiri');
 doc.setProperties({title,author:company});let y=0,page=0;
 const options={align:en?'left' as const:'right' as const,isInputVisual:false,isOutputVisual:true,isInputRtl:!en,isOutputRtl:false};
 function line(value:string,size=11){doc.setFontSize(size);const lines=doc.splitTextToSize(value,500) as string[];for(const l of lines){if(y>760){footer();header();}doc.text(l,en?40:555,y,options);y+=size+8;}}
 function header(){if(page)doc.addPage();page++;doc.setFillColor(16,34,58);doc.rect(0,0,596,82,'F');doc.setTextColor(255,255,255);y=30;line('BUNYRA · '+title,17);line(company+' · '+period,10);doc.setTextColor(22,38,59);y=110;}
 function footer(){doc.setFontSize(9);doc.setTextColor(116,129,148);doc.text(String(page),298,820,{align:'center'});doc.setTextColor(22,38,59);}
 header();for(const note of notes)line(note,10);
 for(const section of sections){
  y+=15;line(section.title,15);const width=515/section.headers.length;
  function row(cells:string[],heading=false){
   doc.setFontSize(10.5);const wrapped=cells.map(value=>doc.splitTextToSize(value,width-14) as string[]),height=Math.max(...wrapped.map(v=>v.length),1)*17+12;
   if(y+height>780){footer();header();if(!heading)row(section.headers,true);}
   if(heading){doc.setFillColor(242,245,249);doc.rect(40,y-8,515,height,'F');}
   wrapped.forEach((lines,i)=>lines.forEach((value,j)=>doc.text(value,en?46+i*width:549-i*width,y+7+j*17,{...options,isInputRtl:/[\u0600-\u06ff]/u.test(value)})));
   y+=height;doc.setDrawColor(231,234,240);doc.line(40,y-7,555,y-7);
  }
  row(section.headers,true);for(const values of section.rows)row(values);
  if(!section.rows.length)line(en?'No data in this scope.':'لا توجد بيانات في النطاق المحدد.');
 }
 footer();return new Uint8Array(doc.output('arraybuffer'));
}
