import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { clear, createStore, set } from 'idb-keyval';
import type { Group } from './types';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn(), getUser: vi.fn(), getSession: vi.fn(), headers: vi.fn() }));
vi.mock('./supabase', () => ({
  getClient: () => ({
    auth: { getUser: mocks.getUser, getSession: mocks.getSession },
    rpc: (name: string, params: unknown) => ({ setHeader: (header: string, value: string) => { mocks.headers('rpc', header, value); return mocks.rpc(name, params, value); } }),
    from: () => ({ select: () => ({ setHeader: (header: string, value: string) => { mocks.headers('select', header, value); return mocks.select(value); } }) }),
  }), createInvite: vi.fn(), acceptInvite: vi.fn(),
}));
import { loadGroups, saveGroupLocally, syncGroups, getLocalVersion, StaleGroupError } from './storage';
import { validateGroup } from './validation';
const store = createStore('fairshare-v1', 'groups');
const sample = (): Group => ({ id: crypto.randomUUID(), name: 'Trip', emoji: '✈️', currency: 'HKD', members: [{ id: 'a', name: 'A' }], expenses: [], settlements: [], revision: 0, updatedAt: new Date().toISOString() });
const session = (id: string) => ({ data: { session: { user: { id }, access_token: `${id}-token` } }, error: null });
const clean = (g: Group) => validateGroup(g);
beforeEach(async () => {
  await clear(store); vi.clearAllMocks();
  mocks.getSession.mockResolvedValue(session('alice'));
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'alice' } }, error: null });
  mocks.select.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockImplementation(async (_name, p) => ({ data: { ...p.p_document, revision: p.p_expected_revision + 1 }, error: null }));
});
describe('offline sync', () => {
  it('isolates local data by account', async () => {
    const g = sample(); await saveGroupLocally('alice', g);
    expect(await loadGroups('bob')).toEqual([]); expect(clean((await loadGroups('alice'))[0])).toEqual(g);
  });
  it('uses original server revision for multiple offline edits', async () => {
    let g = await saveGroupLocally('alice', sample());
    g = await saveGroupLocally('alice', { ...g, name: 'Changed' });
    await saveGroupLocally('alice', { ...g, name: 'Changed again' });
    await syncGroups('alice', 'alice');
    expect(mocks.rpc.mock.calls[0][1].p_expected_revision).toBe(0);
    await syncGroups('alice', 'alice'); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('keeps conflicting local edits instead of overwriting them', async () => {
    const g = sample(); await saveGroupLocally('alice', g);
    mocks.rpc.mockResolvedValue({ error: { message: 'revision_conflict' }, data: null });
    mocks.select.mockResolvedValue({ data: [{ document: { ...g, name: 'Remote', revision: 2 } }], error: null });
    const result = await syncGroups('alice', 'alice'); expect(result.conflicts).toEqual([g.id]); expect(result.groups[0].name).toBe('Trip');
  });
  it('retains edits made while a network write is pending', async () => {
    let g = await saveGroupLocally('alice', sample()); let release!: (value: unknown) => void; let started!: () => void;
    const begin = new Promise<void>(resolve => started = resolve);
    mocks.rpc.mockImplementationOnce(() => { started(); return new Promise(resolve => release = resolve); });
    const syncing = syncGroups('alice', 'alice'); await begin;
    const next = await saveGroupLocally('alice', { ...g, name: 'While syncing' });
    release({ data: { ...clean(g), revision: 1 }, error: null }); await syncing;
    expect((await loadGroups('alice'))[0].name).toBe('While syncing');
    // The acknowledgement must not invalidate the newer, unsynced local snapshot.
    await saveGroupLocally('alice', { ...next, name: 'Continued offline edit' });
    await syncGroups('alice', 'alice'); expect(mocks.rpc.mock.calls[1][1].p_expected_revision).toBe(1);
  });
  it('rejects cross-account synchronization', async () => {
    await expect(syncGroups('bob', 'alice')).rejects.toThrow('Sign in'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('serializes simultaneous sync requests without duplicate writes', async () => {
    await saveGroupLocally('alice', sample());
    await Promise.all([syncGroups('alice', 'alice'), syncGroups('alice', 'alice'), syncGroups('alice', 'alice')]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('offers conflict recovery for currency-stripped data saved by an older app', async () => {
    const g = sample(); await saveGroupLocally('alice', g);
    mocks.rpc.mockResolvedValue({ error: { message: 'Please update Fairshare before editing this group.' }, data: null });
    const result = await syncGroups('alice', 'alice'); expect(result.conflicts).toEqual([g.id]); expect(clean(result.groups[0])).toEqual(g);
  });
});
describe('atomic local snapshot checks', () => {
  it('keeps tokens through spreads, omits them from JSON, and accepts explicit tokens after validation', async () => {
    const g = await saveGroupLocally('alice', sample());
    expect(getLocalVersion({ ...g })).toBe(getLocalVersion(g));
    expect(JSON.parse(JSON.stringify(g))).toEqual(clean(g));
    expect(getLocalVersion(clean(g))).toBeUndefined();
    const next = await saveGroupLocally('alice', { ...clean(g), name: 'Reconstructed' }, getLocalVersion(g));
    expect(getLocalVersion(next)).not.toBe(getLocalVersion(g));
  });
  it('rejects a stale offline snapshot even when both edits share server revision zero', async () => {
    const original = await saveGroupLocally('alice', sample());
    const current = await saveGroupLocally('alice', { ...original, name: 'First offline edit' });
    await expect(saveGroupLocally('alice', { ...original, name: 'Stale offline edit' })).rejects.toBeInstanceOf(StaleGroupError);
    expect((await loadGroups('alice'))[0].name).toBe(current.name);
  });
  it('allows only one of two concurrent writes derived from the same snapshot', async () => {
    const original = await saveGroupLocally('alice', sample());
    const results = await Promise.allSettled([
      saveGroupLocally('alice', { ...original, name: 'Tab A' }),
      saveGroupLocally('alice', { ...original, name: 'Tab B' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
  it('rejects stale tab edits after another tab downloads a newer expense', async () => {
    await saveGroupLocally('alice', sample()); await syncGroups('alice', 'alice');
    const stale = (await loadGroups('alice'))[0];
    const remote = { ...clean(stale), revision: 2, expenses: [{ id: 'e', description: 'New expense', amount: 100, payerId: 'a', splits: [{ memberId: 'a', amount: 100 }], date: '2026-10-18', createdAt: new Date().toISOString() }] };
    mocks.select.mockResolvedValue({ data: [{ document: remote }], error: null });
    await syncGroups('alice', 'alice');
    await expect(saveGroupLocally('alice', { ...stale, name: 'Stale tab' })).rejects.toBeInstanceOf(StaleGroupError);
    expect((await loadGroups('alice'))[0].expenses).toEqual(remote.expenses);
  });
  it('does not invalidate an edit form when own save is acknowledged and identical data is fetched', async () => {
    const original = await saveGroupLocally('alice', sample());
    mocks.select.mockResolvedValue({ data: [{ document: { ...clean(original), revision: 1, updatedAt: '2026-10-18T01:00:00Z' } }], error: null });
    await syncGroups('alice', 'alice');
    expect(getLocalVersion((await loadGroups('alice'))[0])).toBe(getLocalVersion(original));
    await saveGroupLocally('alice', { ...original, name: 'Form left open during sync' });
    expect((await loadGroups('alice'))[0].name).toBe('Form left open during sync');
  });
  it('loads existing pre-token records using their already persisted editId', async () => {
    const g = sample(); await set(`alice:${g.id}`, { group: g, dirty: true, baseRevision: 0, editId: 'existing-edit-id' }, store);
    const loaded = (await loadGroups('alice'))[0]; expect(getLocalVersion(loaded)).toBe('existing-edit-id');
    await saveGroupLocally('alice', { ...loaded, name: 'Migrated without rewriting data' });
  });
  it('ignores older download responses instead of regressing the cached server revision', async () => {
    const g = sample(); await set(`alice:${g.id}`, { group: { ...g, revision: 3 }, dirty: false, baseRevision: 3, editId: 'current' }, store);
    mocks.select.mockResolvedValue({ data: [{ document: { ...g, revision: 2, name: 'Older response' } }], error: null });
    await syncGroups('alice', 'alice'); expect((await loadGroups('alice'))[0].name).toBe('Trip');
  });
});
describe('session-bound requests', () => {
  it('pins both RPC and SELECT to the verified token through an Alice/Bob/Alice switch', async () => {
    const aliceGroup = await saveGroupLocally('alice', sample());
    const bobGroup = { ...sample(), name: 'Bobs private group', ownerId: 'bob' };
    let activeToken = 'alice-token';
    mocks.getUser.mockImplementation(async token => {
      expect(token).toBe('alice-token'); activeToken = 'bob-token';
      mocks.getSession.mockResolvedValue(session('bob'));
      return { data: { user: { id: 'alice' } }, error: null };
    });
    mocks.rpc.mockImplementation(async (_name, p, authorization) => {
      expect(activeToken).toBe('bob-token'); expect(authorization).toBe('Bearer alice-token');
      // Simulate another auth transition before the final read (ABA).
      activeToken = 'alice-token'; mocks.getSession.mockResolvedValue(session('alice'));
      return { data: { ...p.p_document, revision: 1 }, error: null };
    });
    mocks.select.mockImplementation(async authorization => ({ data: [{ document: authorization === 'Bearer alice-token' ? { ...clean(aliceGroup), revision: 1 } : bobGroup }], error: null }));
    await syncGroups('alice', 'alice');
    expect(mocks.headers.mock.calls).toEqual([['rpc', 'Authorization', 'Bearer alice-token'], ['select', 'Authorization', 'Bearer alice-token']]);
    expect((await loadGroups('alice')).map(g => g.id)).toEqual([aliceGroup.id]);
    expect(await loadGroups('bob')).toEqual([]);
  });
  it('rejects a token whose verified owner does not match the requested account', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'bob' } }, error: null });
    await expect(syncGroups('alice', 'alice')).rejects.toThrow('Sign in');
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.select).not.toHaveBeenCalled();
  });
});
