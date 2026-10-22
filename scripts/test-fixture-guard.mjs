import assert from 'node:assert/strict';
import {assertFixtureDatabaseTarget} from './test-fixture-guard.mjs';

const good='postgresql://test:secret@test-branch.neon.tech/neondb';
const prod='postgresql://prod:secret@production.neon.tech/neondb';
const marker=[{user_id:'identity-test-platform-owner'}];
const opts={url:good,fixtureFlag:'1',productionUrl:prod,queryOwner:async()=>marker};
let passed=0;async function test(name,run){await run();passed++;console.log('PASS '+name);}
const deny=(settings,message)=>assert.rejects(()=>assertFixtureDatabaseTarget({...opts,...settings}),error=>error.message.includes(message));
await test('Explicit fixture flag is mandatory',()=>deny({fixtureFlag:'0'},'Fixture tests require'));
await test('A valid test database URL is mandatory',()=>deny({url:''},'Fixture tests require'));
await test('Unexpected URL schemes are rejected',()=>deny({url:'https://test-branch.neon.tech'},'PostgreSQL'));
await test('Production and test cannot share an endpoint',()=>deny({url:prod},'shares the production'));
await test('Migration and test cannot share an endpoint',()=>deny({migrationUrl:good},'shares the production'));
await test('The production owner marker is rejected',()=>deny({queryOwner:async()=>[{user_id:'real-owner'}]},'owner marker'));
await test('An uninitialized database is rejected',()=>deny({queryOwner:async()=>[]},'owner marker'));
await test('Multiple owner records are rejected',()=>deny({queryOwner:async()=>marker.concat(marker)},'owner marker'));
await test('A verified isolated test database passes',async()=>assert.equal(await assertFixtureDatabaseTarget(opts),true));
console.log(JSON.stringify({passed}));
