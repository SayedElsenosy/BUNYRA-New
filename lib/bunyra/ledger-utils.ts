// All amounts are represented as integer minor units; never use floating point for ledger values.
export type LedgerAmountLine={debit_minor:string;credit_minor:string};
export function validateLedgerBalance(lines:readonly LedgerAmountLine[]){
 if(lines.length<2)throw Error('LEDGER_TOO_FEW_LINES');
 let debit=BigInt(0),credit=BigInt(0);
 for(const line of lines){
  if(!/^\d{1,18}$/.test(line.debit_minor)||!/^\d{1,18}$/.test(line.credit_minor))throw Error('LEDGER_INVALID_AMOUNT');
  const d=BigInt(line.debit_minor),c=BigInt(line.credit_minor);
  if((d===BigInt(0))===(c===BigInt(0)))throw Error('LEDGER_INVALID_SIDE');
  debit+=d;credit+=c;
 }
 if(debit===BigInt(0)||debit!==credit)throw Error('LEDGER_UNBALANCED');
 return {debit_minor:debit.toString(),credit_minor:credit.toString()};
}
