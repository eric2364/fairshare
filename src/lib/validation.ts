import type { Group } from './types';
import { MAX_MONEY } from './money';
export const CURRENCIES=['HKD','USD','EUR','GBP','SGD','AUD','CAD'];
const fail=():never=>{throw new Error('This group contains invalid data. Check names, amounts, and dates.');};
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;};
const str=(v:unknown,max=200):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const money=(v:unknown,positive=false):v is number=>Number.isSafeInteger(v)&&Number(v)>=(positive?1:0)&&Number(v)<=MAX_MONEY;
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const timestamp=(v:unknown)=>typeof v==='string'&&v.length<50&&!isNaN(Date.parse(v));
export function validateGroup(value:unknown):Group {
 const g=obj(value);
 if(!str(g.id)||!str(g.name,100)||!str(g.emoji,20)||!CURRENCIES.includes(g.currency as string)||!timestamp(g.updatedAt)||!Number.isSafeInteger(g.revision)||Number(g.revision)<0)fail();
 if(!Array.isArray(g.members)||g.members.length<1||g.members.length>100||!Array.isArray(g.expenses)||g.expenses.length>10000||!Array.isArray(g.settlements)||g.settlements.length>10000)fail();
 const members=g.members as unknown[], expenses=g.expenses as unknown[], settlements=g.settlements as unknown[];
 const ids=new Set<string>(), users=new Set<string>();
 for(const v of members){const m=obj(v);if(!str(m.id)||!str(m.name,100)||ids.has(m.id as string))fail();ids.add(m.id as string);if(m.userId!==undefined){if(!str(m.userId)||users.has(m.userId as string))fail();users.add(m.userId as string);}}
 const eventIds=new Set<string>();
 for(const v of expenses){const e=obj(v);if(!str(e.id)||eventIds.has(e.id as string)||!str(e.description,200)||!money(e.amount,true)||!ids.has(e.payerId as string)||!date(e.date)||!timestamp(e.createdAt)||!Array.isArray(e.splits)||e.splits.length<1)fail();eventIds.add(e.id as string);let total=0;const splitIds=new Set<string>();for(const part of e.splits as unknown[]){const s=obj(part);if(!ids.has(s.memberId as string)||splitIds.has(s.memberId as string)||!money(s.amount))fail();splitIds.add(s.memberId as string);total+=s.amount as number;}if(total!==e.amount)fail();}
 for(const v of settlements){const s=obj(v);if(!str(s.id)||eventIds.has(s.id as string)||!ids.has(s.fromId as string)||!ids.has(s.toId as string)||s.fromId===s.toId||!money(s.amount,true)||!date(s.date))fail();eventIds.add(s.id as string);}
 if(g.ownerId!==undefined&&!str(g.ownerId))fail();
 // Reconstruct known fields so imports cannot carry prototype keys or unrelated data.
 return {id:g.id as string,name:g.name as string,emoji:g.emoji as string,currency:g.currency as string,revision:g.revision as number,updatedAt:g.updatedAt as string,...(g.ownerId?{ownerId:g.ownerId as string}:{}),members:members.map(v=>{const m=obj(v);return {id:m.id as string,name:m.name as string,...(m.userId?{userId:m.userId as string}:{})};}),expenses:expenses.map(v=>{const e=obj(v);return {id:e.id as string,description:e.description as string,amount:e.amount as number,payerId:e.payerId as string,date:e.date as string,createdAt:e.createdAt as string,splits:(e.splits as unknown[]).map(v=>{const s=obj(v);return {memberId:s.memberId as string,amount:s.amount as number};})};}),settlements:settlements.map(v=>{const s=obj(v);return {id:s.id as string,fromId:s.fromId as string,toId:s.toId as string,amount:s.amount as number,date:s.date as string};})};
}
