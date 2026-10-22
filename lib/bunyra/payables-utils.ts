export function totalPayableMinor(lines:readonly {amount_minor:string}[]){
 if(lines.length===0)throw Error('VENDOR_BILL_EMPTY');
 let amount=BigInt(0);
 for(const line of lines){
  if(!/^\d{1,18}$/.test(line.amount_minor)||BigInt(line.amount_minor)<=BigInt(0))throw Error('VENDOR_BILL_AMOUNT_INVALID');
  amount+=BigInt(line.amount_minor);
 }
 if(amount>BigInt('999999999999999999'))throw Error('VENDOR_BILL_AMOUNT_TOO_LARGE');
 return amount.toString();
}
