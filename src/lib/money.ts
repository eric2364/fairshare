import type { Group, SplitMode, Transfer } from './types';
export const MAX_MONEY = 1_000_000_000;
export function parseMoney(input: string): number {
 const value=input.trim();
 if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter a positive amount with up to two decimal places.');
 const [whole, fraction='']=value.split('.');
 const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if (!Number.isSafeInteger(cents)||cents>MAX_MONEY) throw new Error('Amount is too large.');
 return cents;
}
export function formatMoney(amount:number,currency:string):string {return new Intl.NumberFormat('en-HK',{style:'currency',currency}).format(amount/100);}
export function splitAmount(amount:number,memberIds:string[],mode:SplitMode,values?:number[]) {
 if(!Number.isSafeInteger(amount)||amount<=0||amount>MAX_MONEY)throw new Error('Enter an amount greater than zero.');
 if(!memberIds.length||new Set(memberIds).size!==memberIds.length)throw new Error('Choose at least one unique participant.');
 if(mode==='exact') {
  if(!values||values.length!==memberIds.length||values.some(v=>!Number.isSafeInteger(v)||v<0)||values.reduce((a,b)=>a+b,0)!==amount)throw new Error('Exact amounts must add up to the expense total.');
  return memberIds.map((memberId,i)=>({memberId,amount:values[i]}));
 }
 let weights=mode==='equal'?memberIds.map(()=>1):values;
 if(!weights||weights.length!==memberIds.length||weights.some(v=>!Number.isFinite(v)||v<0||v>1_000_000)||weights.reduce((a,b)=>a+b,0)<=0)throw new Error('Enter valid shares for every participant.');
 if(mode==='percent') {
  if(weights.some(v=>Math.abs(v*100-Math.round(v*100))>1e-7)||Math.abs(weights.reduce((a,b)=>a+b,0)-100)>1e-7)throw new Error('Percentages must add up to 100%.');
 }
 // BigInt weights make allocation exact even at the supported amount limit.
 const units=weights.map(v=>BigInt(Math.round(v*1_000_000)));
 const total=units.reduce((a,b)=>a+b,0n);
 if(total<=0n)throw new Error('Shares must be at least 0.000001.');
 const portions=units.map((v,i)=>({i,base:Number(BigInt(amount)*v/total),remainder:BigInt(amount)*v%total}));
 let remaining=amount-portions.reduce((s,p)=>s+p.base,0);
 const ranked=[...portions].sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1);
 for(let i=0;i<remaining;i++)ranked[i].base++;
 return portions.map(p=>({memberId:memberIds[p.i],amount:p.base}));
}
export function groupCurrencies(group:Group):string[] {
 const currencies=new Set([...group.expenses,...group.settlements].map(entry=>entry.currency??group.currency));
 return currencies.size ? [...currencies].sort() : [group.currency];
}
export function expenseTotals(group:Group):Record<string,number> {
 const totals:Record<string,number>={};
 for(const expense of group.expenses){const currency=expense.currency??group.currency;totals[currency]=(totals[currency]??0)+expense.amount;}
 return totals;
}
export function calculateBalances(group:Group,currency=group.currency):Record<string,number> {
 const balances:Record<string,number>=Object.fromEntries(group.members.map(m=>[m.id,0]));
 for(const e of group.expenses){if((e.currency??group.currency)!==currency)continue;balances[e.payerId]+=e.amount;for(const s of e.splits)balances[s.memberId]-=s.amount;}
 for(const s of group.settlements){if((s.currency??group.currency)!==currency)continue;balances[s.fromId]+=s.amount;balances[s.toId]-=s.amount;}
 return balances;
}
export function simplifyDebts(group:Group,currency=group.currency):Transfer[]{
 const balances=calculateBalances(group,currency);
 const debtors=Object.entries(balances).filter(([,a])=>a<0).map(([id,a])=>({id,amount:-a}));
 const creditors=Object.entries(balances).filter(([,a])=>a>0).map(([id,amount])=>({id,amount}));
 const transfers:Transfer[]=[];let i=0,j=0;
 while(i<debtors.length&&j<creditors.length){const amount=Math.min(debtors[i].amount,creditors[j].amount,MAX_MONEY);transfers.push({currency,fromId:debtors[i].id,toId:creditors[j].id,amount});debtors[i].amount-=amount;creditors[j].amount-=amount;if(!debtors[i].amount)i++;if(!creditors[j].amount)j++;}
 return transfers;
}
