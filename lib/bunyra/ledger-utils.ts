// All amounts are represented as integer minor units; never use floating point for ledger values.
export type LedgerAmountLine={debit_minor:string;credit_minor:string};
export function validateLedgerBalance(lines:readonly LedgerAmountLine[]){
 if(lines.length<2)throw Error('LEDGER_TOO_FEW_LINES');
 let debit=0n,credit=0n;
 for(const line of lines){
  if(!/^\d{1,18}$/.test(line.debit_minor)||!/^\d{1,18}$/.test(line.credit_minor))throw Error('LEDGER_INVALID_AMOUNT');
  const d=BigInt(line.debit_minor),c=BigInt(line.credit_minor);
  if((d===0n)===(c===0n))throw Error('LEDGER_INVALID_SIDE');
  debit+=d;credit+=c;
 }
 if(debit===0n||debit!==credit)throw Error('LEDGER_UNBALANCED');
 return {debit_minor:debit.toString(),credit_minor:credit.toString()};
}
