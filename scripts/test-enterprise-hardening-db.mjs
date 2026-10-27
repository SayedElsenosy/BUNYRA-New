import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Never accepts DATABASE_URL or a host supplied by the caller. The only target
// is a new throwaway container on the local Docker socket, without networking.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const container=`bunyra-hardening-${process.pid}-${Date.now()}`;
const env={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(args,{input,quiet=false,allowFailure=false}={})=>{
 const result=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,input,encoding:'utf8',maxBuffer:16*1024*1024});
 if(result.status!==0&&!allowFailure)throw Error(`Local Docker ${args[0]} failed: ${result.stderr||result.error||result.stdout}`);
 if(!quiet&&result.stdout)process.stdout.write(result.stdout);
 return result;
};
const psql=(script)=>docker(['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','bunyra_hardening_test'],{input:script,quiet:true});
docker(['info','--format','{{.ServerVersion}}'],{quiet:true});
try{
 docker(['run','-d','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data',
  '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'],{quiet:true});
 let ready=false;
 for(let attempt=0;attempt<30;attempt++){
  const result=docker(['exec',container,'pg_isready','-U','postgres'],{quiet:true,allowFailure:true});
  if(result.status===0){ready=true;break;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!ready)throw Error('Disposable local Postgres did not become ready');
 docker(['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres'],{
  input:'CREATE ROLE neondb_owner SUPERUSER LOGIN;\nCREATE DATABASE bunyra_hardening_test OWNER neondb_owner;',quiet:true});
 const migrations=fs.readdirSync(path.join(root,'db')).filter(file=>/^\d{3}-[\w-]+\.sql$/.test(file)).sort();
 for(const file of migrations){
  try{psql(fs.readFileSync(path.join(root,'db',file),'utf8'));}
  catch(error){throw Error(`${file}: ${error.message}`);}
 }
 console.log(`PASS ${migrations.length} migrations applied to fresh isolated PostgreSQL`);
 const result=psql(fs.readFileSync(path.join(root,'scripts/test-enterprise-hardening-db.sql'),'utf8'));
 const summary=result.stdout.match(/passed_database_checks\s*\n[-\s]+\n\s*(\d+)/);
 if(!summary)throw Error('Database test summary is missing');
 console.log(`PASS ${summary[1]} real PostgreSQL hardening checks (rolled back)`);
}finally{
 docker(['rm','-f',container],{quiet:true,allowFailure:true});
}
