import {z} from 'zod';
import {calculatePlan,minorUnits} from './projects';
export const paymentPlanSchema=z.object({code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,40}$/),name:z.string().trim().min(2).max(120),down_payment_bps:z.number().int().min(0).max(10000),installments:z.number().int().min(0).max(600),interval_months:z.number().int().min(1).max(12),adjustment_bps:z.number().int().min(-9999).max(100000).default(0)}).strict().refine(p=>p.installments===0?p.down_payment_bps===10000:p.down_payment_bps<10000&&p.installments*p.interval_months<=600,'INVALID_PAYMENT_TERM');
export type PaymentPlan=z.infer<typeof paymentPlanSchema>;
export function majorAmount(minor:string|bigint){const n=BigInt(minor),a=n<BigInt(0)?-n:n;return (n<BigInt(0)?'-':'')+(a/BigInt(100)).toString()+'.'+(a%BigInt(100)).toString().padStart(2,'0');}
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number(s.slice(0,4))>=2000&&Number(s.slice(0,4))<=2100&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s);
function monthDate(date:string,months:number){const d=new Date(date+'T00:00:00Z'),month=d.getUTCMonth()+months,year=d.getUTCFullYear()+Math.floor(month/12),m=month%12,day=Math.min(d.getUTCDate(),new Date(Date.UTC(year,m+1,0)).getUTCDate());return new Date(Date.UTC(year,m,day)).toISOString().slice(0,10);}
export function calculateApprovedPayment(price:string,input:unknown,date:string){
 const p=paymentPlanSchema.parse(input);dateSchema.parse(date);const base=minorUnits(price);if(base<=BigInt(0))throw Error('INVALID_PRICE');
 const total=(base*BigInt(10000+p.adjustment_bps)+BigInt(5000))/BigInt(10000);if(total<=BigInt(0))throw Error('INVALID_PRICE');
 const result=p.installments?calculatePlan(majorAmount(total),p.down_payment_bps,p.installments):{total:total.toString(),down_payment:total.toString(),installments:[] as string[]};
 return {base_price_minor:base.toString(),total_minor:result.total,adjustment_minor:(total-base).toString(),down_payment_minor:result.down_payment,installments:result.installments.map((amount,i)=>({number:i+1,due_date:monthDate(date,(i+1)*p.interval_months),amount_minor:amount})),down_payment_due:date};
}
