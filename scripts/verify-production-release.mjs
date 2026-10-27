const base='https://bunyra-new.sayedelsenosy65.workers.dev';
async function check(){
 const [health,release,session]=await Promise.all([
  fetch(base+'/api/health',{cache:'no-store'}),
  fetch(base+'/bunyra-release.json?release=20261027',{cache:'no-store'}),
  fetch(base+'/api/session',{cache:'no-store'})
 ]);
 if(!health.ok)throw Error('Production health failed: '+health.status);
 const marker=await release.json();
 if(marker.release!=='2026-10-27-enterprise-hardening')throw Error('Release marker mismatch');
 if(session.status!==401)throw Error('Anonymous session boundary failed: '+session.status);
 console.log(JSON.stringify({health:health.status,release:marker.release,schema:marker.schema,anonymousSession:session.status}));
}
for(let attempt=0;;attempt++){try{await check();break}catch(error){if(attempt>=5)throw error;await new Promise(r=>setTimeout(r,10000));}}
