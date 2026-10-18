export const UNIT_COLUMNS=[
 ['code','Unit Code','كود الوحدة'],['project_name','Project Name','اسم المشروع'],['phase','phase','المرحلة'],
 ['building','Building Name','اسم المبنى'],['floor','Floor Number','رقم الدور'],['category','Unit Type','نوع الوحدة'],
 ['area','Gross Area (sqm)','المساحة الإجمالية م²'],['price_per_sqm','Price per sqm','سعر المتر كما بالشيت'],
 ['out_area','Out Area','المساحة الخارجية'],['out_price_per_sqm','Price per sqm ( Out area )','سعر متر المساحة الخارجية'],
 ['delivery_status','Delivery Status','حالة التسليم'],['status','Availability Status','حالة الإتاحة'],
 ['proposed_price','Total Price','السعر الإجمالي المقترح'],['source_column_3','Column 3','Column 3'],['source_div80','/80','/80'],['active','Active','التفعيل']
] as const;
export const DETAIL_FIELDS=['project_name','phase','price_per_sqm','out_area','out_price_per_sqm','delivery_status','source_column_3','source_div80','source_total_price','source_availability'] as const;
export const PRIVATE_DETAIL_FIELDS=['price_per_sqm','out_price_per_sqm','source_div80','source_total_price'] as const;
export function detailValues(c:Record<string,unknown>){return Object.fromEntries(DETAIL_FIELDS.map(f=>[f,String(c[f]??'')]));}
