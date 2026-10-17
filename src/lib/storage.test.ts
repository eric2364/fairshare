import 'fake-indexeddb/auto';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {clear,createStore} from 'idb-keyval';
import type {Group} from './types';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),select:vi.fn(),getUser:vi.fn()}));
vi.mock('./supabase',()=>({getClient:()=>({auth:{getUser:mocks.getUser},rpc:mocks.rpc,from:()=>({select:mocks.select})}),createInvite:vi.fn(),acceptInvite:vi.fn()}));
import {loadGroups,saveGroupLocally,syncGroups} from './storage';
const sample=():Group=>({id:crypto.randomUUID(),name:'Trip',emoji:'✈️',currency:'HKD',members:[{id:'a',name:'A'}],expenses:[],settlements:[],revision:0,updatedAt:new Date().toISOString()});
beforeEach(async()=>{await clear(createStore('fairshare-v1','groups'));vi.clearAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:'alice'}},error:null});mocks.select.mockResolvedValue({data:[],error:null});mocks.rpc.mockImplementation(async(_name,p)=>({data:{...p.p_document,revision:p.p_expected_revision+1},error:null}));});
describe('offline sync',()=>{
 it('isolates local data by account',async()=>{const g=sample();await saveGroupLocally('alice',g);expect(await loadGroups('bob')).toEqual([]);expect(await loadGroups('alice')).toEqual([g]);});
 it('uses original server revision for multiple offline edits',async()=>{const g=sample();await saveGroupLocally('alice',g);await saveGroupLocally('alice',{...g,name:'Changed'});await syncGroups('alice','alice');expect(mocks.rpc.mock.calls[0][1].p_expected_revision).toBe(0);await syncGroups('alice','alice');expect(mocks.rpc).toHaveBeenCalledTimes(1);});
 it('keeps conflicting local edits instead of overwriting them',async()=>{const g=sample();await saveGroupLocally('alice',g);mocks.rpc.mockResolvedValue({error:{message:'revision_conflict'},data:null});mocks.select.mockResolvedValue({data:[{document:{...g,name:'Remote',revision:2}}],error:null});const result=await syncGroups('alice','alice');expect(result.conflicts).toEqual([g.id]);expect(result.groups[0].name).toBe('Trip');});
 it('retains edits made while a network write is pending',async()=>{const g=sample();await saveGroupLocally('alice',g);let release!:(value:unknown)=>void;let started!:()=>void;const begin=new Promise<void>(resolve=>started=resolve);mocks.rpc.mockImplementationOnce(()=>{started();return new Promise(resolve=>release=resolve)});const syncing=syncGroups('alice','alice');await begin;await saveGroupLocally('alice',{...g,name:'While syncing'});release({data:{...g,revision:1},error:null});await syncing;expect((await loadGroups('alice'))[0].name).toBe('While syncing');await syncGroups('alice','alice');expect(mocks.rpc.mock.calls[1][1].p_expected_revision).toBe(1);});
 it('rejects cross-account synchronization',async()=>{await expect(syncGroups('bob','alice')).rejects.toThrow('Sign in');expect(mocks.rpc).not.toHaveBeenCalled();});
 it('serializes simultaneous sync requests without duplicate writes',async()=>{await saveGroupLocally('alice',sample());await Promise.all([syncGroups('alice','alice'),syncGroups('alice','alice'),syncGroups('alice','alice')]);expect(mocks.rpc).toHaveBeenCalledTimes(1);});
});

it('offers conflict recovery for currency-stripped data saved by an older app',async()=>{const g=sample();await saveGroupLocally('alice',g);mocks.rpc.mockResolvedValue({error:{message:'Please update Fairshare before editing this group.'},data:null});const result=await syncGroups('alice','alice');expect(result.conflicts).toEqual([g.id]);expect(result.groups[0]).toEqual(g);});
