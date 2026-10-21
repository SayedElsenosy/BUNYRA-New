import {identity,platformIdentity,json,failure,sameOrigin} from '../../../lib/bunyra/http';
import {planCatalog,savePlan,assignSubscription,companySubscription} from '../../../lib/bunyra/subscriptions';
import {ServiceError} from '../../../lib/bunyra/service';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const u=new URL(request.url);
  if(u.searchParams.get('scope')==='catalog'){
   const {sql,user}=await platformIdentity();
   return json(await planCatalog(sql,user));
  }
  const {sql,actor}=await identity();
  const company=u.searchParams.get('company')||'';
  return json(await companySubscription(sql,actor,company,u.searchParams.get('mode')==='platform'));
 }catch(e){return failure(e);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const {sql,user}=await platformIdentity();
  const payload=await request.json();
  if(payload?.operation!=='plan')throw new ServiceError('INVALID_OPERATION',400);
  return json(await savePlan(sql,user,payload.data));
 }catch(e){return failure(e);}
}
export async function PATCH(request:Request){
 try{
  sameOrigin(request);
  const {sql,user}=await platformIdentity();
  const payload=await request.json();
  if(payload?.operation!=='assign')throw new ServiceError('INVALID_OPERATION',400);
  return json(await assignSubscription(sql,user,payload.data));
 }catch(e){return failure(e);}
}
