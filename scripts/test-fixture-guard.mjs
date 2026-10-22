import { neon } from '@neondatabase/serverless';

const FIXTURE_OWNER='identity-test-platform-owner';
export async function assertFixtureDatabaseTarget({
 url=process.env.BUNYRA_TEST_DATABASE_URL,
 fixtureFlag=process.env.BUNYRA_ALLOW_TEST_FIXTURES,
 productionUrl=process.env.DATABASE_URL,
 migrationUrl=process.env.MIGRATE_DATABASE_URL,
 queryOwner,
}={}){
 if(!url||fixtureFlag!=='1')throw Error('Fixture tests require BUNYRA_TEST_DATABASE_URL and BUNYRA_ALLOW_TEST_FIXTURES=1');
 let target;
 try{target=new URL(url);}catch{throw Error('Invalid test database URL');}
 if(!['postgres:','postgresql:'].includes(target.protocol))throw Error('Test database URL must be PostgreSQL');
 const host=x=>x.hostname.replace(/-pooler(?=\.)/,'');
 for(const value of [productionUrl,migrationUrl].filter(Boolean)){
  let existing;
  try{existing=new URL(value);}catch{throw Error('Invalid production/migration database URL');}
  if(host(target)===host(existing)&&target.port===existing.port)throw Error('Test database shares the production/migration endpoint');
 }
 const owners=queryOwner?await queryOwner():await neon(url).query('SELECT user_id FROM platform_owner');
 if(owners.length!==1||owners[0].user_id!==FIXTURE_OWNER)throw Error('Refusing fixture writes: isolated test owner marker is missing or mismatched');
 return true;
}
