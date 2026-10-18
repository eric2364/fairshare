export type Member = { id: string; name: string; userId?: string };
export type Expense = { id: string; currency?: string; description: string; amount: number; payerId: string; date: string; splits: { memberId: string; amount: number }[]; createdAt: string };
export type Settlement = { id: string; currency?: string; fromId: string; toId: string; amount: number; date: string };
export type Group = { id: string; name: string; emoji: string; currency: string; currencies?: string[]; members: Member[]; expenses: Expense[]; settlements: Settlement[]; updatedAt: string; revision: number; ownerId?: string };
export type SplitMode = 'equal' | 'exact' | 'percent' | 'shares';
export type Transfer = { currency: string; fromId: string; toId: string; amount: number };
