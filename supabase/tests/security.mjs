import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(f=>f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url),'utf8'));
}
const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002', gid='00000000-0000-4000-8000-000000000010';
await db.query('insert into auth.users values ($1),($2)',[a,b]);
const user=async id=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
await user(a);
const group={id:gid,name:'Trip',emoji:'🌴',currency:'HKD',members:[{id:'a',name:'Owner',userId:a},{id:'b',name:'Friend'}],expenses:[{id:'e',description:'Dinner',payerId:'a',amount:101,date:'2026-10-18',createdAt:new Date().toISOString(),splits:[{memberId:'a',amount:51},{memberId:'b',amount:50}]}],settlements:[],revision:0,updatedAt:new Date().toISOString()};
const save=async(d,r)=>(await db.query('select public.save_group($1::jsonb,$2::bigint) as d',[JSON.stringify(d),r])).rows[0].d;
let saved=await save(group,0); assert.equal(saved.revision,1);
await assert.rejects(()=>save(saved,null),/invalid_revision/);
// Simulate a server commit whose response was lost: replay the original payload.
const replayed=await save(group,0);assert.deepEqual(replayed,saved);
// A stale document with a different semantic payload must not overwrite anything.
const stale=structuredClone(saved);stale.name='Changed offline';
await assert.rejects(()=>save(stale,0),/revision_conflict/);
let bad=structuredClone(saved);bad.expenses[0].amount='101';await assert.rejects(()=>save(bad,1),/invalid_expense/);
bad=structuredClone(saved);bad.expenses[0].splits[0].amount=50;await assert.rejects(()=>save(bad,1),/split_total_mismatch/);
const token=(await db.query('select create_group_invite($1,$2) as token',[gid,'b'])).rows[0].token;
await user(b);
assert.equal((await db.query('select * from expense_groups')).rows.length,0);
await assert.rejects(()=>save(saved,1),/group_access_denied/);
await assert.rejects(()=>db.query('update expense_groups set revision = 2'),/permission denied/);
await db.query('select accept_group_invite($1)',[token]);
saved=(await db.query('select document from expense_groups')).rows[0].document;
assert.equal(saved.members[1].userId,b);assert.equal(saved.revision,2);
await assert.rejects(()=>db.query('select accept_group_invite($1)',[token]),/invite_expired_or_used/);
bad=structuredClone(saved);bad.members[0].userId=b;await assert.rejects(()=>save(bad,2),/membership_change_requires_invite/);
saved=await save(saved,2);assert.equal(saved.revision,3);
const changed=structuredClone(saved);changed.name='Updated online';
const afterUpdate=await save(changed,3);assert.equal(afterUpdate.revision,4);
assert.deepEqual(await save(changed,3),afterUpdate);
await assert.rejects(()=>save(saved,3),/revision_conflict/);
// Per-entry denomination is optional for legacy data, explicit on new clients.
const mixed=structuredClone(afterUpdate);
mixed.expenses[0].currency='USD';
mixed.expenses.push({...structuredClone(mixed.expenses[0]),id:'e-eur',currency:'EUR'});
mixed.expenses.push({...structuredClone(group.expenses[0]),id:'legacy-hkd'});
mixed.settlements.push({id:'payment',fromId:'b',toId:'a',amount:50,date:'2026-10-18',currency:'USD'});
let multi=await save(mixed,4);
assert.equal(multi.expenses[0].currency,'USD');assert.equal(multi.expenses[1].currency,'EUR');
assert.equal(multi.expenses[2].currency,undefined);assert.equal(multi.currency,'HKD');
for(const invalid of ['JPY','usd','',null,123]) {
 const badExpense=structuredClone(multi);badExpense.expenses[0].currency=invalid;
 await assert.rejects(()=>save(badExpense,5),/invalid_expense_currency/);
 const badSettlement=structuredClone(multi);badSettlement.settlements[0].currency=invalid;
 await assert.rejects(()=>save(badSettlement,5),/invalid_settlement_currency/);
}
const oldClient=structuredClone(multi);
oldClient.expenses.forEach(e=>delete e.currency);oldClient.settlements.forEach(e=>delete e.currency);
oldClient.expenses[0].amount=201;oldClient.expenses[0].splits[0].amount=151;
oldClient.settlements[0].amount=40;
oldClient.expenses.push({...structuredClone(group.expenses[0]),id:'new-from-old-app'});
await assert.rejects(()=>save(oldClient,5),/Please update Fairshare before editing this group/);
const oldSettlement=structuredClone(multi);delete oldSettlement.settlements[0].currency;
await assert.rejects(()=>save(oldSettlement,5),/Please update Fairshare before editing this group/);
// A current client can keep a legacy entry and explicitly change denomination.
const newClient=structuredClone(multi);newClient.expenses[0].currency='GBP';
newClient.expenses.push({...structuredClone(group.expenses[0]),id:'new-legacy-entry'});
const explicit=await save(newClient,5);assert.equal(explicit.expenses[0].currency,'GBP');
assert.equal(explicit.expenses[3].currency,undefined);
assert.deepEqual(await save(newClient,5),explicit);
const changedDefault=structuredClone(explicit);changedDefault.currency='USD';
await assert.rejects(()=>save(changedDefault,6),/currency_cannot_change/);
// Deletion remains possible; it does not relabel an existing entry.
const deleted=structuredClone(explicit);deleted.expenses.splice(0,1);deleted.settlements=[];
const afterDelete=await save(deleted,6);assert.equal(afterDelete.expenses.length,3);
console.log('PASS: migration, create/update, lost-response replay, null/stale revision rejection, numeric typing, split totals, RLS isolation, direct write denial, invite claim/single use, membership preservation, per-entry currencies, invalid currency rejection, legacy compatibility, old-client denomination-loss rejection.');
await db.close();
