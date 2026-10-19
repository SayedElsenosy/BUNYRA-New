import {identity,sameOrigin,json,failure} from '../../../../lib/bunyra/http';
import {importInventory} from '../../../../lib/bunyra/imports';
import {syncInventory} from '../../../../lib/bunyra/inventory-sync';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{sameOrigin(request);const {sql,actor}=await identity();const text=await request.text();if(text.length>1500000)return json({error:'FILE_TOO_LARGE'},413);const {operation,import_mode='add',...body}=JSON.parse(text);if(!['preview','commit'].includes(operation)||!['add','sync'].includes(import_mode))return json({error:'VALIDATION_ERROR'},400);return json(await (import_mode==='sync'?syncInventory:importInventory)(sql,actor,body,operation==='commit',new URL(request.url).searchParams.get('mode')==='platform'));}catch(e){return failure(e);}}
