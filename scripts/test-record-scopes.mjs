import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const dir='.sites-runtime/record-scopes';
fs.mkdirSync(dir,{recursive:true});
const options={module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022};
fs.writeFileSync(dir+'/permissions.mjs',ts.transpileModule(fs.readFileSync('lib/bunyra/permissions.ts','utf8'),{compilerOptions:options}).outputText);
fs.writeFileSync(dir+'/service.mjs', 'export async function access(sql){return sql.ctx} export class ServiceError extends Error {constructor(code,status){super(code);this.code=code;this.status=status}}');
const source=ts.transpileModule(fs.readFileSync('lib/bunyra/record-scope.ts','utf8'),{compilerOptions:options}).outputText.replaceAll("from './service'","from './service.mjs'").replaceAll("from './permissions'","from './permissions.mjs'");
fs.writeFileSync(dir+'/record-scope.mjs',source);
const {bookingScope,requireBooking,requireContract}=await import('../'+dir+'/record-scope.mjs');
const actor={userId:'seller-1',email:'seller-1@example.com'};
const projects=['p1','p2'];
const bookings=[{id:'b1',project_id:'p1',sales_user_id:'seller-1',status:'approved'}, {id:'b2',project_id:'p2',sales_user_id:'seller-2',status:'approved'}];
const contracts=[{id:'c1',booking_id:'b1'}, {id:'c2',booking_id:'b2'}];
const grant=(action,project_id,allowed=true)=>({action,project_id,allowed});
function sqlFor(role,overrides=[],owner=false){
 const calls=[];
 const sql=(parts,...params)=>{
  const query=parts.join('?');calls.push({query,params});
  if(query.includes('SELECT id FROM projects'))return Promise.resolve(projects.map(id=>({id})));
  if(query.includes('SELECT id FROM bookings')){
   const [company,authorized,users]=params;
   assert.equal(company,'company1');
   return Promise.resolve(bookings.filter(b=>authorized.includes(b.project_id)&&(!users||users.includes(b.sales_user_id))).map(({id})=>({id})));
  }
  if(query.includes('SELECT * FROM bookings'))return Promise.resolve(bookings.filter(x=>x.id===params[1]));
  if(query.includes('SELECT * FROM contracts'))return Promise.resolve(contracts.filter(x=>x.id===params[1]));
  throw Error('Unexpected SQL: '+query);
 };
 sql.ctx={owner,role,custom:null,overrides};
 sql.calls=calls;return sql;
}
const checks=[];
async function check(name,fn){await fn();checks.push(name);}
await check('Unassigned accountant sees no booking IDs and performs no booking table read',async()=>{
 const sql=sqlFor('accountant');
 const value=await bookingScope(sql,actor,'company1','bookings.read');
 assert.deepEqual(value.ids,[]);
 assert.equal(sql.calls.filter(c=>c.query.includes('FROM bookings')).length,0);
});
await check('Project grant limits accountant to permitted project before SQL',async()=>{
 const sql=sqlFor('accountant',[grant('bookings.read','p1')]);
 const value=await bookingScope(sql,actor,'company1','bookings.read');
 assert.deepEqual(value.ids,['b1']);
 const statement=sql.calls.find(c=>c.query.includes('SELECT id FROM bookings'));
 assert.deepEqual(statement.params[1],['p1']);
});
await check('Company grant alone never opens every accountant project',async()=>{
 const sql=sqlFor('accountant',[grant('bookings.read',null)]);
 assert.deepEqual((await bookingScope(sql,actor,'company1','bookings.read')).ids,[]);
});
await check('Company deny blocks a grant to an accountant project',async()=>{
 const sql=sqlFor('accountant',[grant('bookings.read','p1'),grant('bookings.read',null,false)]);
 assert.deepEqual((await bookingScope(sql,actor,'company1','bookings.read')).ids,[]);
});
await check('Sales user can only access their own bookings',async()=>{
 const sql=sqlFor('sales');
 assert.deepEqual((await bookingScope(sql,actor,'company1','bookings.read')).ids,['b1']);
 await assert.rejects(()=>requireBooking(sql,actor,'company1','b2','bookings.read'),e=>e.code==='FORBIDDEN');
});
await check('Denied accountant cannot fetch an unrelated contract',async()=>{
 const sql=sqlFor('accountant',[grant('finance.read','p1')]);
 await assert.rejects(()=>requireContract(sql,actor,'company1','c2','finance.read'),e=>e.code==='FORBIDDEN');
});
await check('Finance manager retains broad project access',async()=>{
 const sql=sqlFor('finance_manager');
 assert.deepEqual((await bookingScope(sql,actor,'company1','bookings.read')).ids,['b1','b2']);
});
await check('Verified platform owner remains unrestricted in its selected company',async()=>{
 const sql=sqlFor('company_admin',[],true);
 assert.deepEqual((await bookingScope(sql,actor,'company1','bookings.read')).ids,['b1','b2']);
});
console.log(JSON.stringify({passed:checks.length,checks},null,2));
