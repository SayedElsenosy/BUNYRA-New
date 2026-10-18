// Isolated-development test adapter. Credential and payload files stay outside the repository.
import fs from 'node:fs';
import {planStorage} from '../.sites-runtime/tests/storage.mjs';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),job=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
Object.assign(process.env,config);
try{
 const storage=planStorage();let result;
 if(job.type==='put')result=await storage.put(job.key,fs.readFileSync(job.path),job.mime);
 if(job.type==='get')result={bytes:Array.from(await storage.get(job.key))};
 if(job.type==='begin')result=await storage.begin(job.key,job.mime);
 if(job.type==='part')result=await storage.part(job.key,job.upload,job.part,fs.readFileSync(job.path));
 if(job.type==='parts')result=await storage.parts(job.key,job.upload);
 if(job.type==='complete')result=await storage.complete(job.key,job.upload,job.parts);
 if(job.type==='abort')result=await storage.abort(job.key,job.upload);
 if(job.type==='head')result=await storage.head(job.key);
 if(job.type==='open'){const r=await storage.open(job.key,job.range);result={...r,body:undefined,bytes:Array.from(new Uint8Array(await new Response(r.body).arrayBuffer()))};}
 console.log(JSON.stringify({ok:true,result:result??null}));
}catch(e){console.log(JSON.stringify({ok:false,name:e.name,message:e.message,status:e.$metadata?.httpStatusCode||0}));process.exitCode=1;}
