export function monthlyDepreciation(costMinor:string,residualMinor:string,months:number,monthIndex:number):string{
 if(!/^\d+$/.test(costMinor)||!/^\d+$/.test(residualMinor)||!Number.isInteger(months)||months<1||months>600||!Number.isInteger(monthIndex)||monthIndex<0||monthIndex>=months)throw Error('ASSET_INVALID_INPUT');
 const cost=BigInt(costMinor),residual=BigInt(residualMinor),life=BigInt(months);
 if(residual>=cost||cost-residual<life||cost>BigInt('9223372036854775807'))throw Error('ASSET_INVALID_COST');
 return ((cost-residual)/life+(BigInt(monthIndex)<(cost-residual)%life?BigInt(1):BigInt(0))).toString();
}
