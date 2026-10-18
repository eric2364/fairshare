import {describe,it,expect} from 'vitest';
import {parseMoney,splitAmount,calculateBalances,simplifyDebts,groupCurrencies,expenseTotals,amountToInput,formatMoney,availableCurrencies} from './money';
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

describe('per-entry currencies',()=>{
 const mixed:Group={...group,expenses:[...group.expenses,{...group.expenses[0],id:'usd',currency:'USD',amount:3000,payerId:'b',splits:splitAmount(3000,['a','b','c'],'equal')}],settlements:[{id:'usd-payment',currency:'USD',fromId:'a',toId:'b',amount:400,date:'2026-10-18'}]};
 it('keeps equal-looking HKD and USD amounts in separate ledgers',()=>{
  expect(calculateBalances(mixed,'HKD')).toEqual({a:6666,b:-3333,c:-3333});
  expect(calculateBalances(mixed,'USD')).toEqual({a:-600,b:1600,c:-1000});
  expect(calculateBalances(mixed,'EUR')).toEqual({a:0,b:0,c:0});
 });
 it('settles each currency without reducing debts in other currencies',()=>{
  const transfers=simplifyDebts(mixed,'USD');
  expect(transfers.every(t=>t.currency==='USD')).toBe(true);
  const settled={...mixed,settlements:[...mixed.settlements,...transfers.map((t,i)=>({...t,id:`paid-${i}`,date:'2026-10-18'}))]};
  expect(calculateBalances(settled,'USD')).toEqual({a:0,b:0,c:0});
  expect(calculateBalances(settled,'HKD')).toEqual(calculateBalances(mixed,'HKD'));
 });
 it('preserves currencies through backup round trips',()=>expect(validateGroup(JSON.parse(JSON.stringify(mixed)))).toEqual(mixed));
 it('rejects invalid or null currencies on expenses and repayments',()=>{
  for(const currency of ['XYZ',null,1,'']){
   expect(()=>validateGroup({...mixed,expenses:[{...mixed.expenses[0],currency}]})).toThrow();
   expect(()=>validateGroup({...mixed,settlements:[{...mixed.settlements[0],currency}]})).toThrow();
  }
 });
 it('uses the legacy default currency for existing repayments',()=>{
  const legacy={...mixed,settlements:[{id:'legacy',fromId:'b',toId:'a',amount:3333,date:'2026-10-18'}]};
  expect(calculateBalances(legacy,'HKD')).toEqual({a:3333,b:0,c:-3333});
  expect(calculateBalances(legacy,'USD')).toEqual({a:-1000,b:2000,c:-1000});
 });
});

it('reports totals per currency and lists settlement-only currencies',()=>{const g={...group,expenses:[...group.expenses,{...group.expenses[0],id:'usd',currency:'USD',amount:1234}],settlements:[{id:'s',currency:'EUR',fromId:'a',toId:'b',amount:10,date:'2026-10-18'}]};expect(expenseTotals(g)).toEqual({HKD:10000,USD:1234});expect(groupCurrencies(g)).toEqual(['EUR','HKD','USD']);});


it('splits large debts into valid recordable repayments without losing cents',()=>{
 const huge:Group={...group,expenses:[0,1].map(i=>({...group.expenses[0],id:`large-${i}`,amount:1_000_000_000,splits:[{memberId:'b',amount:1_000_000_000}]}))};
 const transfers=simplifyDebts(huge);
 expect(transfers.map(t=>t.amount)).toEqual([1_000_000_000,1_000_000_000]);
 let current=huge;
 for(const [i,t] of transfers.entries())current=validateGroup({...current,settlements:[...current.settlements,{...t,id:`paid-${i}`,date:'2026-10-18'}]});
 expect(calculateBalances(current)).toEqual({a:0,b:0,c:0});
});

it('handles whole-yen amounts and preserves two-decimal currencies',()=>{
 expect(parseMoney('1234','JPY')).toBe(1234);
 expect(()=>parseMoney('1234.50','JPY')).toThrow('whole-yen');
 expect(parseMoney('1234.50','TWD')).toBe(123450);
 expect(amountToInput(1234,'JPY')).toBe('1234');
 expect(amountToInput(123450,'TWD')).toBe('1234.50');
 expect(formatMoney(1234,'JPY')).toContain('1,234');
 expect(formatMoney(1234,'JPY')).not.toContain('.00');
 expect(splitAmount(parseMoney('100','JPY'),['a','b','c'],'equal').map(s=>s.amount)).toEqual([34,33,33]);
});
it('round-trips group currency selections and legacy defaults',()=>{
 const selected={...group,currencies:['HKD','JPY','TWD','USD']};
 expect(validateGroup(selected)).toEqual(selected);
 expect(availableCurrencies(selected)).toEqual(selected.currencies);
 expect(availableCurrencies(group)).toContain('JPY');
 expect(validateGroup(group).currencies).toBeUndefined();
 for(const currencies of [[],['HKD','HKD'],['USD'],['HKD','XYZ'],null,'HKD'])expect(()=>validateGroup({...group,currencies})).toThrow();
 const yen={...group,currencies:['HKD','JPY'],expenses:[{...group.expenses[0],currency:'JPY',amount:100,splits:splitAmount(100,['a','b','c'],'equal')}]};
 expect(validateGroup( yen).expenses[0].amount).toBe(100);
 expect(()=>validateGroup({...yen,currencies:['HKD']})).toThrow();
 expect(()=>validateGroup({...selected,settlements:[{id:'euro',currency:'EUR',fromId:'a',toId:'b',amount:100,date:'2026-10-18'}]})).toThrow();
});
