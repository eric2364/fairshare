import {describe,it,expect} from 'vitest';
import {parseMoney,splitAmount,calculateBalances,simplifyDebts} from './money';
import {validateGroup} from './validation';
import type {Group} from './types';
const group:Group={id:'g',name:'Dinner',emoji:'🍽️',currency:'HKD',revision:0,updatedAt:'2026-10-18T12:00:00Z',members:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],expenses:[{id:'e',description:'Food',amount:10000,payerId:'a',date:'2026-10-18',createdAt:'2026-10-18T12:00:00Z',splits:splitAmount(10000,['a','b','c'],'equal')}],settlements:[]};
describe('money',()=>{
 it('parses decimal amounts without floating point rounding',()=>{expect(parseMoney('0.29')).toBe(29);expect(parseMoney('100.1')).toBe(10010);expect(parseMoney('0')).toBe(0);for(const v of ['1.001','-1','1e3','NaN','1,000','Infinity','10000001'])expect(()=>parseMoney(v)).toThrow();});
 it('allocates remainder cents deterministically',()=>expect(splitAmount(100,['a','b','c'],'equal').map(s=>s.amount)).toEqual([34,33,33]));
 it('preserves exact, percent, and share totals',()=>{expect(splitAmount(100,['a','b'],'exact',[30,70]).map(s=>s.amount)).toEqual([30,70]);expect(splitAmount(101,['a','b'],'percent',[25,75]).map(s=>s.amount)).toEqual([25,76]);expect(splitAmount(101,['a','b'],'shares',[1,3]).map(s=>s.amount)).toEqual([25,76]);expect(()=>splitAmount(100,['a','b'],'percent',[30,60])).toThrow();expect(()=>splitAmount(100,['a','b'],'exact',[30,69])).toThrow();});
 it('always conserves cents over a range of group sizes and totals',()=>{for(let n=1;n<=25;n++)for(let a=1;a<1000;a+=17){const ids=Array.from({length:n},(_,i)=>String(i));const splits=splitAmount(a,ids,'shares',ids.map((_,i)=>i+1));expect(splits.reduce((s,v)=>s+v.amount,0)).toBe(a);expect(splits.every(s=>Number.isInteger(s.amount)&&s.amount>=0)).toBe(true);}});
 it('calculates zero-sum balances and clears them with suggested repayments',()=>{expect(calculateBalances(group)).toEqual({a:6666,b:-3333,c:-3333});const transfers=simplifyDebts(group);const settled={...group,settlements:transfers.map((t,i)=>({...t,id:String(i),date:'2026-10-18'}))};expect(Object.values(calculateBalances(settled))).toEqual([0,0,0]);});
 it('keeps partial repayments outstanding',()=>{expect(calculateBalances({...group,settlements:[{id:'s',fromId:'b',toId:'a',amount:1000,date:'2026-10-18'}]})).toEqual({a:5666,b:-2333,c:-3333});});
});
describe('backup validation',()=>{
 it('accepts valid data and strips unrelated fields',()=>{expect(validateGroup({...group,untrusted:'value'})).toEqual(group);});
 it('rejects invalid split totals, duplicate ids, invalid dates and member references',()=>{for(const invalid of [{...group,members:[...group.members,group.members[0]]},{...group,expenses:[{...group.expenses[0],amount:1}]},{...group,expenses:[{...group.expenses[0],payerId:'unknown'}]},{...group,expenses:[{...group.expenses[0],date:'2026-02-30'}]},{...group,settlements:[{id:'s',fromId:'a',toId:'a',amount:2,date:'2026-10-18'}]}])expect(()=>validateGroup(invalid)).toThrow();});
});
