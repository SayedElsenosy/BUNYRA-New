export type TrialBalanceLine={kind:'asset'|'liability'|'equity'|'income'|'expense';debit_minor:string;credit_minor:string};
export function summarizeTrialBalance(lines:readonly TrialBalanceLine[]){
 let debits=BigInt(0),credits=BigInt(0),assets=BigInt(0),liabilities=BigInt(0),
 equity=BigInt(0),income=BigInt(0),expenses=BigInt(0);
 for(const line of lines){
  const d=BigInt(line.debit_minor),c=BigInt(line.credit_minor);
  if(d<BigInt(0)||c<BigInt(0))throw Error('LEDGER_INVALID_AMOUNT');
  debits+=d;credits+=c;
  switch(line.kind){
   case 'asset':assets+=d-c;break;
   case 'liability':liabilities+=c-d;break;
   case 'equity':equity+=c-d;break;
   case 'income':income+=c-d;break;
   case 'expense':expenses+=d-c;break;
  }
 }
 const profit=income-expenses;
 return {debit_minor:debits.toString(),credit_minor:credits.toString(),
  balanced:debits===credits,
  assets_minor:assets.toString(),liabilities_minor:liabilities.toString(),
  equity_minor:equity.toString(),income_minor:income.toString(),
  expenses_minor:expenses.toString(),profit_minor:profit.toString(),
  accounting_equation_holds:assets===liabilities+equity+profit};
}
