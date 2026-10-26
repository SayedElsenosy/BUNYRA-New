import assert from "node:assert/strict";
import PizZip from "pizzip";
import {sampleContractWord,renderWordTemplate,assertWordTemplate} from "../lib/bunyra/word-render.mjs";

const sample=sampleContractWord();
assert(sample.byteLength>250 && sample.byteLength<5*1024*1024,"Valid small DOCX sample");
assert.doesNotThrow(()=>assertWordTemplate(sample),"Sample must compile with Docxtemplater");
const bytes=renderWordTemplate(sample,{
 contract_number:"BUNYRA-2026-0001",signed_date:"2026-10-27",
 customer_name:"Ahmed & Co",customer_phone:"01012345678",customer_national_id:"29901010000000",
 project_name:"Cairo Plaza",unit_number:"A-102",unit_area:"100.5",
 contract_value:"1000000.00",currency:"EGP",
 installments:[{number:1,amount:"400000.00",due_date:"2026-11-01"},
  {number:2,amount:"600000.00",due_date:"2026-12-01"}],
});
const zip=new PizZip(bytes);
const xml=zip.file("word/document.xml")?.asText()||"";
assert(xml.includes("BUNYRA-2026-0001"),"Contract number substituted");
assert(xml.includes("Cairo Plaza"),"Project name substituted");
assert(xml.includes("29901010000000"),"National ID substituted");
assert(xml.includes("Ahmed &amp; Co"),"User data is XML escaped");
assert(xml.includes("400000.00") && xml.includes("600000.00"),"Both installments rendered");
assert(!xml.includes("{contract_number}")&&!xml.includes("{#installments}"),"Placeholders resolved");
assert.throws(()=>assertWordTemplate(new Uint8Array([1,2,3])),"Reject corrupt archive");
console.log("Word DOCX sample/render validation passed",bytes.byteLength,"bytes");
