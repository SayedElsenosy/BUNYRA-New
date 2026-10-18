export const IMPORT_FIELDS=['code','building','floor','category','area','proposed_price','status','active'] as const;
const aliases:Record<string,string[]>={
 code:['code','unit code','unit number','unit no','unit id','كود الوحدة','رقم الوحدة','الكود'],
 building:['building','building code','building name','المبنى','كود المبنى','اسم المبنى'],
 floor:['floor','floor number','floor no','الدور','الطابق','رقم الدور'],
 category:['category','type','unit type','التصنيف','نوع الوحدة'],
 area:['area','gross area','gross area sqm','gross area m2','المساحة','المساحة م²','المساحة الإجمالية'],
 proposed_price:['price','proposed price','total price','selling price','السعر','السعر المقترح','السعر الأساسي','إجمالي السعر'],
 status:['status','availability','availability status','unit status','الحالة','حالة الوحدة'],
 active:['active','is active','التفعيل','مفعلة']
};
export function normalizeHeader(value:string){return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');}
export function mapImportHeaders(headers:string[]){return Object.fromEntries(IMPORT_FIELDS.map(field=>{const i=headers.findIndex(h=>aliases[field].some(a=>normalizeHeader(a)===normalizeHeader(h)));return [field,i<0?'':String(i)];}));}
export function mappedCell(row:unknown[],index:string|undefined){return index!==undefined&&/^\d+$/.test(index)?row[Number(index)]??'':'';}
export function invalidCodeHeader(header:string){return /cancel|cancl|status|availability|إلغاء|حالة/i.test(header);}
