-- Private shared expense documents. Clients can read their groups; writes go through RPCs.
create table public.expense_groups (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  revision bigint not null default 1,
  document jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.group_memberships (
  group_id uuid not null references public.expense_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  member_id text not null,
  primary key (group_id, user_id),
  unique (group_id, member_id)
);
create table public.group_invites (
  token_hash bytea primary key,
  group_id uuid not null references public.expense_groups(id) on delete cascade,
  member_id text,
  expires_at timestamptz not null default now() + interval '7 days',
  consumed_at timestamptz
);
alter table public.expense_groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.group_invites enable row level security;
create policy own_membership on public.group_memberships for select to authenticated using (user_id = auth.uid());
create policy member_read on public.expense_groups for select to authenticated using (
  exists (select 1 from public.group_memberships m where m.group_id = id and m.user_id = auth.uid())
);
revoke all on public.expense_groups, public.group_memberships, public.group_invites from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.expense_groups, public.group_memberships to authenticated;

create function public.validate_group_document(d jsonb) returns void
language plpgsql set search_path = '' as $$
declare m jsonb; e jsonb; s jsonb; x jsonb; ids text[]; seen text[]; total numeric;
begin
  if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'name') is distinct from 'string' or jsonb_typeof(d->'currency') is distinct from 'string' or length(coalesce(d->>'name','')) not between 1 and 100
    or coalesce(d->>'currency','') not in ('HKD','USD','EUR','GBP','SGD','AUD','CAD')
    or jsonb_typeof(d->'emoji') is distinct from 'string' or length(coalesce(d->>'emoji','')) not between 1 and 20
    or jsonb_typeof(d->'members') is distinct from 'array'
    or jsonb_typeof(d->'expenses') is distinct from 'array'
    or jsonb_typeof(d->'settlements') is distinct from 'array'
    or pg_column_size(d) > 2000000 then raise exception 'invalid_group'; end if;
  if jsonb_array_length(d->'members') not between 1 and 100 then raise exception 'invalid_members'; end if;
  if jsonb_array_length(d->'expenses') > 10000 or jsonb_array_length(d->'settlements') > 10000 then raise exception 'too_many_entries'; end if;
  ids := array[]::text[];
  for m in select value from jsonb_array_elements(d->'members') loop
    if jsonb_typeof(m->'id') is distinct from 'string' or jsonb_typeof(m->'name') is distinct from 'string' or length(coalesce(m->>'id','')) not between 1 and 100 or length(coalesce(m->>'name','')) not between 1 and 100
      or m->>'id' = any(ids) then raise exception 'invalid_member'; end if;
    ids := array_append(ids, m->>'id');
  end loop;
  seen := array[]::text[];
  for e in select value from jsonb_array_elements(d->'expenses') loop
    if jsonb_typeof(e->'id') is distinct from 'string' or jsonb_typeof(e->'description') is distinct from 'string' or length(coalesce(e->>'id','')) not between 1 and 100 or e->>'id' = any(seen)
      or length(coalesce(e->>'description','')) not between 1 and 200
      or jsonb_typeof(e->'createdAt') is distinct from 'string' or length(coalesce(e->>'createdAt','')) not between 1 and 49
      or jsonb_typeof(e->'payerId') is distinct from 'string'
      or not coalesce(e->>'payerId' = any(ids), false)
      or jsonb_typeof(e->'amount') is distinct from 'number' or coalesce(e->>'amount','') !~ '^[0-9]+$'
      or (e->>'amount')::numeric not between 1 and 1000000000
      or jsonb_typeof(e->'splits') is distinct from 'array'
      or coalesce(e->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_expense'; end if;
    perform (e->>'date')::date; perform (e->>'createdAt')::timestamptz;
    seen := array_append(seen,e->>'id'); total := 0;
    declare split_ids text[] := array[]::text[];
    begin
      for x in select value from jsonb_array_elements(e->'splits') loop
        if jsonb_typeof(x->'memberId') is distinct from 'string' or not coalesce(x->>'memberId' = any(ids),false) or x->>'memberId' = any(split_ids)
          or jsonb_typeof(x->'amount') is distinct from 'number' or coalesce(x->>'amount','') !~ '^[0-9]+$' or (x->>'amount')::numeric > 1000000000 then raise exception 'invalid_split'; end if;
        split_ids := array_append(split_ids,x->>'memberId'); total := total + (x->>'amount')::numeric;
      end loop;
    end;
    if total <> (e->>'amount')::numeric then raise exception 'split_total_mismatch'; end if;
  end loop;
  for s in select value from jsonb_array_elements(d->'settlements') loop
    if jsonb_typeof(s->'id') is distinct from 'string' or length(coalesce(s->>'id','')) not between 1 and 100 or s->>'id' = any(seen)
      or jsonb_typeof(s->'fromId') is distinct from 'string' or jsonb_typeof(s->'toId') is distinct from 'string'
      or not coalesce(s->>'fromId' = any(ids),false) or not coalesce(s->>'toId' = any(ids),false)
      or s->>'fromId' = s->>'toId' or jsonb_typeof(s->'amount') is distinct from 'number' or coalesce(s->>'amount','') !~ '^[0-9]+$'
      or (s->>'amount')::numeric not between 1 and 1000000000
      or coalesce(s->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_settlement'; end if;
    perform (s->>'date')::date;
    seen := array_append(seen,s->>'id');
  end loop;
end $$;

create function public.save_group(p_document jsonb, p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); gid uuid := (p_document->>'id')::uuid; existing public.expense_groups; result jsonb; owner_member text; next_revision bigint;
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'invalid_revision'; end if;
  perform public.validate_group_document(p_document);
  select * into existing from public.expense_groups where id = gid for update;
  if not found then
    if p_expected_revision <> 0 then raise exception 'revision_conflict'; end if;
    select value->>'id' into owner_member from jsonb_array_elements(p_document->'members') where value->>'userId' = uid::text;
    if owner_member is null or (select count(*) from jsonb_array_elements(p_document->'members') where coalesce(value->>'userId','') <> '') <> 1 then raise exception 'invalid_owner_member'; end if;
    result := p_document || jsonb_build_object('revision',1,'ownerId',uid,'updatedAt',now());
    insert into public.expense_groups(id, owner_id, revision, document) values(gid,uid,1,result);
    insert into public.group_memberships(group_id,user_id,member_id) values(gid,uid,owner_member);
    return result;
  end if;
  if not exists(select 1 from public.group_memberships where group_id = gid and user_id = uid) then raise exception 'group_access_denied'; end if;
  if existing.revision <> p_expected_revision then
    -- A lost HTTP response can leave a committed document queued locally. A retry
    -- is successful only if its entire semantic payload still matches the server.
    -- This never overwrites newer edits and still requires group membership.
    if p_expected_revision < existing.revision
      and (p_document - array['revision','updatedAt','ownerId']) = (existing.document - array['revision','updatedAt','ownerId']) then
      return existing.document;
    end if;
    raise exception 'revision_conflict';
  end if;
  -- Every claimed identity must remain attached to its original member and no unclaimed identity can be injected.
  if exists(select 1 from public.group_memberships mm where mm.group_id = gid and not exists(
    select 1 from jsonb_array_elements(p_document->'members') m where m->>'id' = mm.member_id and m->>'userId' = mm.user_id::text))
    or exists(select 1 from jsonb_array_elements(p_document->'members') m where coalesce(m->>'userId','') <> '' and not exists(
      select 1 from public.group_memberships mm where mm.group_id = gid and mm.member_id = m->>'id' and mm.user_id::text = m->>'userId')) then raise exception 'membership_change_requires_invite'; end if;
  if p_document->>'currency' <> existing.document->>'currency' then raise exception 'currency_cannot_change'; end if;
  next_revision := existing.revision + 1;
  result := p_document || jsonb_build_object('revision',next_revision,'ownerId',existing.owner_id,'updatedAt',now());
  update public.expense_groups set document = result, revision = next_revision, updated_at = now() where id = gid;
  return result;
end $$;

create function public.create_group_invite(p_group_id uuid, p_member_id text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare token text; doc jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.group_memberships where group_id = p_group_id and user_id = auth.uid()) then raise exception 'group_access_denied'; end if;
  select document into doc from public.expense_groups where id = p_group_id for update;
  if p_member_id is not null and not exists(select 1 from jsonb_array_elements(doc->'members') m where m->>'id' = p_member_id and coalesce(m->>'userId','') = '') then raise exception 'member_already_claimed_or_missing'; end if;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
  insert into public.group_invites(token_hash,group_id,member_id) values(sha256(convert_to(token,'UTF8')),p_group_id,p_member_id);
  return token;
end $$;

create function public.accept_group_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); invitation public.group_invites; g public.expense_groups; mid text; members jsonb; result jsonb;
begin
  if uid is null then raise exception 'authentication_required'; end if;
  select * into invitation from public.group_invites where token_hash = sha256(convert_to(p_token,'UTF8')) for update;
  if not found or invitation.expires_at <= now() or invitation.consumed_at is not null then raise exception 'invite_expired_or_used'; end if;
  select * into g from public.expense_groups where id = invitation.group_id for update;
  if exists(select 1 from public.group_memberships where group_id = g.id and user_id = uid) then return g.id; end if;
  mid := coalesce(invitation.member_id, gen_random_uuid()::text);
  if invitation.member_id is not null then
    if not exists(select 1 from jsonb_array_elements(g.document->'members') m where m->>'id' = mid and coalesce(m->>'userId','') = '') then raise exception 'member_already_claimed_or_missing'; end if;
    select jsonb_agg(case when m->>'id' = mid then m || jsonb_build_object('userId',uid) else m end) into members from jsonb_array_elements(g.document->'members') m;
  else
    members := (g.document->'members') || jsonb_build_array(jsonb_build_object('id',mid,'name','New member','userId',uid));
  end if;
  result := g.document || jsonb_build_object('members',members,'revision',g.revision+1,'updatedAt',now());
  perform public.validate_group_document(result);
  insert into public.group_memberships(group_id,user_id,member_id) values(g.id,uid,mid);
  update public.expense_groups set document = result, revision = g.revision+1, updated_at = now() where id = g.id;
  update public.group_invites set consumed_at = now() where token_hash = invitation.token_hash;
  return g.id;
end $$;
revoke all on function public.validate_group_document(jsonb), public.save_group(jsonb,bigint), public.create_group_invite(uuid,text), public.accept_group_invite(text) from public, anon;
grant execute on function public.save_group(jsonb,bigint), public.create_group_invite(uuid,text), public.accept_group_invite(text) to authenticated;
