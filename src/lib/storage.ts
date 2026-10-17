import { createStore, del, entries, update } from 'idb-keyval';
import type { Group } from './types';
import { getClient } from './supabase';
import { validateGroup } from './validation';
function validateRemote(value: unknown): Group {
  try { return validateGroup(value); } catch { throw new Error('The server returned invalid group data. Your local changes are preserved.'); }
}
const db = createStore('fairshare-v1', 'groups');
type Saved = { group: Group; dirty: boolean; baseRevision: number; editId: string };
const key = (scope: string, id: string) => `${encodeURIComponent(scope)}:${id}`;
const prefix = (scope: string) => `${encodeURIComponent(scope)}:`;
async function records(scope: string) { return (await entries<string, Saved>(db)).filter(([k]) => k.startsWith(prefix(scope))); }
export async function loadGroups(scope: string): Promise<Group[]> {
  return (await records(scope)).map(([, v]) => v.group).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveGroupLocally(scope: string, group: Group): Promise<void> {
  const k = key(scope, group.id);
  await update<Saved>(k, prior => ({ group, dirty: true, baseRevision: prior?.baseRevision ?? group.revision ?? 0, editId: crypto.randomUUID() }), db);
}
// Removes only the local copy. A synced group will reappear at the next sync.
export async function deleteLocalGroup(scope: string, id: string): Promise<void> { await del(key(scope, id), db); }
let syncTail: Promise<unknown> = Promise.resolve();
export function syncGroups(scope: string, userId: string): Promise<{ groups: Group[]; conflicts: string[] }> {
  const run = syncTail.catch(() => undefined).then(() => performSync(scope, userId));
  syncTail = run;
  return run;
}
async function performSync(scope: string, userId: string) {
  const client = getClient();
  if (!client) return { groups: await loadGroups(scope), conflicts: [] };
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || auth.user?.id !== userId || scope !== userId) throw new Error('Sign in to sync this account.');
  const conflicts: string[] = [];
  for (const [k, saved] of await records(scope)) {
    if (!saved.dirty) continue;
    const { data, error } = await client.rpc('save_group', { p_document: saved.group, p_expected_revision: saved.baseRevision });
    if (error) {
      if (error.message.includes('revision_conflict') || error.message.includes('Please update Fairshare')) { conflicts.push(saved.group.id); continue; }
      throw error;
    }
    const remote = validateRemote(data);
    // Apply acknowledgement atomically so a simultaneous local edit is never overwritten.
    await update<Saved>(k, current => {
      if (!current) return { ...saved, group: remote, dirty: false, baseRevision: remote.revision };
      return current.editId === saved.editId
        ? { group: remote, dirty: false, baseRevision: remote.revision, editId: saved.editId }
        : { ...current, group: { ...current.group, revision: remote.revision }, baseRevision: remote.revision };
    }, db);
  }
  const { data, error } = await client.from('expense_groups').select('document');
  if (error) throw error;
  for (const row of data ?? []) {
    const group = validateRemote(row.document);
    const k = key(scope, group.id);
    await update<Saved>(k, local => {
      if (!local?.dirty) return { group, dirty: false, baseRevision: group.revision, editId: crypto.randomUUID() };
      if (local.baseRevision !== group.revision && !conflicts.includes(group.id)) conflicts.push(group.id);
      return local;
    }, db);
  }
  return { groups: await loadGroups(scope), conflicts };
}
export { createInvite, acceptInvite } from './supabase';
