// Test-only bridge for runtimes where the SQL orchestration process has no network.
// The two input files are private scratch files outside the repository.
import fs from 'node:fs';
import {testStorage} from './test-files.mjs';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),job=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
try{const storage=testStorage(config);if(job.type==='storage_put'){await storage.put(job.key,new Uint8Array(job.bytes),job.mime);console.log(JSON.stringify({ok:true}));}else{const data=await storage.get(job.key);console.log(JSON.stringify({ok:true,bytes:Array.from(data)}));}}catch(e){console.log(JSON.stringify({ok:false,name:e.name,status:e.$metadata?.httpStatusCode||0}));process.exitCode=1;}
