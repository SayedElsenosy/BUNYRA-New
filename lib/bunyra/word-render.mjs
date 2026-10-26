import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export function sampleContractWord(){
 const zip=new PizZip();
 const items=[
 "BUNYRA | Contract {contract_number}",
 "Date: {signed_date}",
 "Customer: {customer_name} | Phone: {customer_phone}",
 "National ID: {customer_national_id}",
 "Project: {project_name} | Unit: {unit_number} | Area: {unit_area}",
 "Contract value: {contract_value} {currency}",
 "{#installments}Installment {number}: {amount} due {due_date}{/installments}",
 ];
 const paragraphs=items.map(s=>"<w:p><w:r><w:t xml:space=\"preserve\">"+s+"</w:t></w:r></w:p>").join("");
 zip.file("word/document.xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
 '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+paragraphs+'<w:sectPr/></w:body></w:document>');
 zip.file("[Content_Types].xml",'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
 '<Default Extension="xml" ContentType="application/xml"/>'+
 '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"/></Types>');
 zip.file("_rels/.rels",'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 return zip.generate({type:"uint8array",compression:"DEFLATE"});
}

export function renderWordTemplate(bytes, values){
 const doc=new Docxtemplater(new PizZip(bytes),{paragraphLoop:true,linebreaks:true});
 doc.render(values);
 return doc.getZip().generate({type:"uint8array",compression:"DEFLATE"});
}
export function assertWordTemplate(bytes){
 new Docxtemplater(new PizZip(bytes),{paragraphLoop:true,linebreaks:true});
}
