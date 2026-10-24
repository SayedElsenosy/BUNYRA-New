import type {VendorStatementRow} from './vendor-statement';
export function statementAmount(minor:string){const n=BigInt(minor),v=n<BigInt(0)?-n:n;return (n<BigInt(0)?'-':'')+(v/BigInt(100)).toString()+'.'+(v%BigInt(100)).toString().padStart(2,'0');}
export function statementEvent(row:Pick<VendorStatementRow,'source_type'|'source_event'>,en:boolean){
 const e=row.source_event,t=(ar:string,english:string)=>en?english:ar;
 if(row.source_type!=='vendor_bill')return t('قيد محاسبي','Journal entry');
 if(e.startsWith('credit_reversed_'))return t('عكس إشعار خصم','Credit correction');
 if(e.startsWith('refund_reversed_'))return t('عكس استرداد','Refund correction');
 if(e.startsWith('payment_reversed_'))return t('عكس سداد','Payment correction');
 if(e.startsWith('credit_'))return t('إشعار خصم','Credit note');
 if(e.startsWith('refund_'))return t('استرداد من المورد','Received refund');
 if(e.startsWith('payment_'))return t('سداد مورد','Supplier payment');
 return t('فاتورة مورد / قيد مرتبط','Vendor bill / related entry');
}
