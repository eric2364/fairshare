import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let client: SupabaseClient | null | undefined;
export function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
  return client;
}
function requiredClient() { const c = getClient(); if (!c) throw new Error('Cloud sharing is not configured yet.'); return c; }
export async function createInvite(groupId: string, memberId?: string): Promise<string> {
  const { data, error } = await requiredClient().rpc('create_group_invite', { p_group_id: groupId, p_member_id: memberId ?? null });
  if (error) throw error;
  return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(String(data))}`;
}
export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await requiredClient().rpc('accept_group_invite', { p_token: token });
  if (error) throw error;
  return String(data);
}
