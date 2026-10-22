const roles:Record<string,[string,string]>={company_admin:['مدير الشركة','Company administrator'],operations:['العمليات','Operations'],sales:['المبيعات','Sales'],sales_manager:['مدير المبيعات','Sales manager'],sales_admin:['مسؤول المبيعات','Sales administrator'],finance_manager:['المدير المالي','Finance manager'],accountant:['محاسب','Accountant']};
const currencies:Record<string,[string,string]>={EGP:['جنيه مصري','EGP'],USD:['دولار أمريكي','USD'],SAR:['ريال سعودي','SAR'],AED:['درهم إماراتي','AED'],EUR:['يورو','EUR'],GBP:['جنيه إسترليني','GBP']};
export const roleLabel=(value:string,en=false)=>roles[value]?.[en?1:0]||value;
export const currencyLabel=(value:string|null|undefined,en=false)=>value?(currencies[value]?.[en?1:0]||value):'';
const zones:Record<string,[string,string]>={'Africa/Cairo':['القاهرة','Cairo'],'Asia/Riyadh':['الرياض','Riyadh'],'Asia/Dubai':['دبي','Dubai'],'UTC':['التوقيت العالمي','UTC']};
export const timeZoneLabel=(value:string|null|undefined,en=false)=>value?(zones[value]?.[en?1:0]||value):'';
