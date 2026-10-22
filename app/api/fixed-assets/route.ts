import {z} from 'zod';
import {identity,sameOrigin,json,failure} from '../../../lib/bunyra/http';
import {fixedAssetsOverview,createFixedAsset,postAssetDepreciation} from '../../../lib/bunyra/fixed-assets';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{const {sql,actor}=await identity(),u=new URL(request.url);
  return json(await fixedAssetsOverview(sql,actor,u.searchParams.get('company')||'',u.searchParams.get('mode')==='platform'));
 }catch(e){return failure(e);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);const {sql,actor}=await identity(),u=new URL(request.url);
  const {operation,...input}=z.record(z.string(),z.unknown()).parse(await request.json());
  const platform=u.searchParams.get('mode')==='platform';
  if(operation==='create')return json(await createFixedAsset(sql,actor,input,platform),201);
  if(operation==='post_depreciation')return json(await postAssetDepreciation(sql,actor,input,platform));
  return json({error:'INVALID_OPERATION'},400);
 }catch(e){return failure(e);}
}
