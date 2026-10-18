import {unzipSync,strFromU8} from 'fflate';
// XML attributes only; no formulas, scripts, external links or workbook instructions execute.
function attributes(tag:string){return Object.fromEntries(Array.from(tag.matchAll(/([\w:.-]+)\s*=\s*['"]([^'"]*)['"]/g),m=>[m[1],m[2]]));}
export function firstSheetVisibility(bytes:Uint8Array){
 const files=unzipSync(bytes,{filter:f=>/^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/[^/]+\.xml)$/.test(f.name)&&f.originalSize<=20*1024*1024});
 const workbook=files['xl/workbook.xml'];if(!workbook)throw Error('file');
 const sheetTag=strFromU8(workbook).match(/<(?:\w+:)?sheet\b[^>]*>/)?.[0];if(!sheetTag)throw Error('file');
 const sheet=attributes(sheetTag),relationships=files['xl/_rels/workbook.xml.rels'];if(!relationships)throw Error('file');
 const rel=Array.from(strFromU8(relationships).matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g),m=>attributes(m[0])).find(r=>r.Id===sheet['r:id']);
 if(!rel||rel.TargetMode==='External')throw Error('file');
 const target=rel.Target.startsWith('/')?rel.Target.slice(1):'xl/'+rel.Target.replace(/^\.\//,'');
 const xml=files[target];if(!xml)throw Error('file');const hidden=new Set<number>();
 for(const match of strFromU8(xml).matchAll(/<(?:\w+:)?row\b[^>]*>/g)){const row=attributes(match[0]);if(row.hidden==='1'||row.hidden==='true')hidden.add(Number(row.r));}
 return {hiddenRows:Array.from(hidden),sheetName:sheet.name};
}
