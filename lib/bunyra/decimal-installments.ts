import Decimal from 'decimal.js';
import type {calculateApprovedPayment} from './pricing-calculator';

// Decimal.js handles exact cents while the established BUNYRA pricing plan
// remains the authority for installment dates, pricing and allocations.
// No JS Number is used for arithmetic. Company scope belongs to caller's
// verified session and SQL transaction, not the pure math helper.
const DecimalMoney=Decimal.clone({precision:42,rounding:Decimal.ROUND_HALF_UP});
type Approved=ReturnType<typeof calculateApprovedPayment>;
export type ExactInstallment={number:number;due_date:string;amount_minor:string};
function cents(value:string):Decimal {
 if(!/^(0|[1-9]\d*)$/.test(value))throw new Error('INVALID_MINOR_AMOUNT');
 const parsed=new DecimalMoney(value);
 if(!parsed.isFinite()||!parsed.isInteger()||parsed.lt(0))
  throw new Error('INVALID_MINOR_AMOUNT');
 return parsed;
}
export function generateInstallmentsExact(approved:Approved):ExactInstallment[]{
 const total=cents(approved.total_minor);
 const down=cents(approved.down_payment_minor);
 if(total.lte(0)||down.gt(total))throw new Error('INVALID_PAYMENT_SNAPSHOT');
 const output:ExactInstallment[]=[];
 if(down.gt(0))output.push({
  number:1,due_date:approved.down_payment_due,amount_minor:down.toFixed(0),
 });
 for(const row of approved.installments){
  const amount=cents(row.amount_minor);
  if(amount.lte(0))throw new Error('INVALID_INSTALLMENT');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row.due_date))throw new Error('INVALID_DUE_DATE');
  output.push({number:output.length+1,due_date:row.due_date,amount_minor:amount.toFixed(0)});
 }
 if(!output.length)throw new Error('EMPTY_INSTALLMENTS');
 const sum=output.reduce((acc,item)=>acc.plus(cents(item.amount_minor)),new DecimalMoney(0));
 if(!sum.eq(total))throw new Error('INSTALLMENT_TOTAL_MISMATCH');
 if(!output.every(v=>v.number>0))throw new Error('INVALID_SEQUENCE');
 return output;
}
