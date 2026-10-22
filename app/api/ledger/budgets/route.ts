import {z} from 'zod';
import {identity,sameOrigin,json,failure} from '../../../../lib/bunyra/http';
import {projectBudgetOverview,createProjectBudget,approveProjectBudget} from '../../../../lib/bunyra/project-budgets';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const {sql,actor}=await identity(),params=new URL(request.url).searchParams;
  return json(await projectBudgetOverview(sql,actor,{
   company_id:params.get('company'),entity_id:params.get('entity'),
   from_month:params.get('from_month'),to_month:params.get('to_month'),
   project_id:params.get('project')||null
  },params.get('mode')==='platform'));
 }catch(error){return failure(error);}
}
export async function POST(request:Request){
 try{
  sameOrigin(request);
  const {sql,actor}=await identity(),url=new URL(request.url);
  const {operation,...input}=z.record(z.string(),z.unknown()).parse(await request.json());
  const platform=url.searchParams.get('mode')==='platform';
  if(operation==='draft')return json(await createProjectBudget(sql,actor,input,platform),201);
  if(operation==='approve')return json(await approveProjectBudget(sql,actor,input,platform));
  return json({error:'INVALID_OPERATION'},400);
 }catch(error){return failure(error);}
}
