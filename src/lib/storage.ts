import { createStore, del, entries, update } from 'idb-keyval';
import type { Group } from './types';
import { getClient } from './supabase';
import { validateGroup } from './validation';
function validateRemote(value: unknown): Group {
  try { return validateGroup(value); } catch { throw new Error('The server returned invalid group data. Your local changes are preserved.'); }
}
const db = createStore('fairshare-v1', 'groups');
type Saved = { group: Group; dirty: boolean; baseRevision: number; editId: string };
// Enumerable symbols survive UI object spreads but never enter JSON exports or
// IndexedDB documents. Callers that reconstruct a group must pass this explicitly.
const localVersion = Symbol('fairshareLocalVersion');
type VersionedGroup = Group & { [localVersion]?: string };
export function getLocalVersion(group: Group): string | undefined { return (group as VersionedGroup)[localVersion]; }
function snapshot(saved: Saved): Group { return Object.assign({ ...saved.group }, { [localVersion]: saved.editId }); }
function semanticDocument(group: Group): string {
  const { revision: _revision, updatedAt: _updatedAt, ownerId: _ownerId, ...document } = validateGroup(group);
  return JSON.stringify(document);
}
const key = (scope: string, id: string) => `${encodeURIComponent(scope)}:${id}`;
const prefix = (scope: string) => `${encodeURIComponent(scope)}:`;
async function records(scope: string) { return (await entries<string, Saved>(db)).filter(([k]) => k.startsWith(prefix(scope))); }
export async function loadGroups(scope: string): Promise<Group[]> {
  return (await records(scope)).map(([, saved]) => snapshot(saved)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export class StaleGroupError extends Error {
  constructor() { super('This group changed in another tab. Reload the group and try again.'); this.name = 'StaleGroupError'; }
}
export async function saveGroupLocally(scope: string, group: Group, expectedVersion = getLocalVersion(group)): Promise<Group> {
  const k = key(scope, group.id);
  const document = validateGroup(group);
  let result!: Saved;
  // One read-write IDB transaction compares and saves, including across tabs.
  await update<Saved>(k, prior => {
    if (prior ? prior.editId !== expectedVersion : expectedVersion !== undefined) throw new StaleGroupError();
    result = { group: document, dirty: true, baseRevision: prior?.baseRevision ?? document.revision, editId: crypto.randomUUID() };
    return result;
  }, db);
  return snapshot(result);
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
  // Bind every request to this exact token, not the mutable global auth client.
  // A->B->A account switches during a request cannot change its server identity.
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  if (sessionError || !token || sessionData.session?.user.id !== userId || scope !== userId) throw new Error('Sign in to sync this account.');
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || auth.user?.id !== userId) throw new Error('Sign in to sync this account.');
  const authorization = `Bearer ${token}`;
  const conflicts: string[] = [];
  for (const [k, saved] of await records(scope)) {
    if (!saved.dirty) continue;
    const { data, error } = await client.rpc('save_group', { p_document: saved.group, p_expected_revision: saved.baseRevision }).setHeader('Authorization', authorization);
    if (error) {
      if (error.message.includes('revision_conflict') || error.message.includes('Please update Fairshare')) { conflicts.push(saved.group.id); continue; }
      throw error;
    }
    const remote = validateRemote(data);
    // Acknowledging our own write changes metadata, not the local edit version.
    // Preserve edits made in flight and never regress a revision from another tab.
    await update<Saved>(k, current => {
      if (!current) return { ...saved, group: remote, dirty: false, baseRevision: remote.revision };
      if (current.baseRevision > remote.revision) return current;
      return current.editId === saved.editId
        ? { group: remote, dirty: false, baseRevision: remote.revision, editId: semanticDocument(remote) === semanticDocument(saved.group) ? saved.editId : crypto.randomUUID() }
        : { ...current, group: { ...current.group, revision: remote.revision }, baseRevision: remote.revision };
    }, db);
  }
  const { data, error } = await client.from('expense_groups').select('document').setHeader('Authorization', authorization);
  if (error) throw error;
  for (const row of data ?? []) {
    const group = validateRemote(row.document);
    const k = key(scope, group.id);
    await update<Saved>(k, local => {
      if (local && local.baseRevision > group.revision) return local;
      if (!local?.dirty) return {
        group, dirty: false, baseRevision: group.revision,
        editId: local && semanticDocument(local.group) === semanticDocument(group) ? local.editId : crypto.randomUUID(),
      };
      if (local.baseRevision !== group.revision && !conflicts.includes(group.id)) conflicts.push(group.id);
      return local;
    }, db);
  }
  return { groups: await loadGroups(scope), conflicts };
}
export { createInvite, acceptInvite } from './supabase';
