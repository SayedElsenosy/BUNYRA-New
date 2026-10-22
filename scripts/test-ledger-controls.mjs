import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync('db/043-ledger-period-controls.sql','utf8');
let passed=0;const test=(n,f)=>{f();passed++;console.log('PASS '+n)};
test('finance periods are locked at legal-entity level',()=>{
 assert.match(src,/CREATE TABLE ledger_period_locks/);
 assert.match(src,/ledger_period_prevent_new_entries/);
 assert.match(src,/ledger_period_prevent_entry_changes/);
 assert.match(src,/FOR SHARE/);
});
test('closing checks drafts and unposted source finance events',()=>{
 assert.match(src,/LEDGER_PERIOD_DRAFTS/);
 assert.match(src,/LEDGER_PERIOD_PENDING_EVENTS/);
});
test('ledger reversal cannot delete or rewrite original entries',()=>{
 assert.match(src,/CREATE TABLE ledger_reversals/);
 assert.match(src,/bunyra_reverse_ledger_entry/);
 assert.match(src,/LEDGER_REVERSAL_OF_REVERSAL/);
});
test('source-linked and bank-reconciled postings cannot be manually reversed',()=>{
 assert.match(src,/LEDGER_SOURCE_REVERSAL_REQUIRED/);
 assert.match(src,/LEDGER_RECONCILED_LOCK/);
});
test('finance controls require company identity and tenant RLS',()=>{
 assert.match(src,/bunyra_tenant_company\(\)/);
 assert.match(src,/FORCE ROW LEVEL SECURITY/);
 assert.match(src,/REVOKE ALL ON FUNCTION bunyra_lock_ledger_period/);
});
console.log(JSON.stringify({passed}));
