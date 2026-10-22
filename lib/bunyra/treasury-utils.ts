export function assertBankStatementBalance(opening:string,closing:string,movements:readonly string[]){
 const minor=(s:string)=>{if(!/^-?\d{1,18}$/.test(s))throw Error('TREASURY_INVALID_AMOUNT');return BigInt(s)};
 const calculated=movements.reduce((sum,m)=>sum+minor(m),minor(opening));
 if(calculated!==minor(closing))throw Error('TREASURY_BALANCE_MISMATCH');
 return calculated.toString();
}
