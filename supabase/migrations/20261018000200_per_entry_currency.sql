-- Per-entry currencies, legacy defaults, and protection against stale clients.
-- Function replacement preserves existing grants and RLS behavior.
create or replace function public.validate_group_document(d jsonb) returns void
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
    if e ? 'currency' and (jsonb_typeof(e->'currency') is distinct from 'string' or e->>'currency' not in ('HKD','USD','EUR','GBP','SGD','AUD','CAD')) then raise exception 'invalid_expense_currency'; end if;
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
    if s ? 'currency' and (jsonb_typeof(s->'currency') is distinct from 'string' or s->>'currency' not in ('HKD','USD','EUR','GBP','SGD','AUD','CAD')) then raise exception 'invalid_settlement_currency'; end if;
    perform (s->>'date')::date;
    seen := array_append(seen,s->>'id');
  end loop;
end $$;

create or replace function public.save_group(p_document jsonb, p_expected_revision bigint) returns jsonb
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
  -- Old clients strip entry currencies and display mixed balances incorrectly.
  -- Block their writes rather than silently relabeling debts or accepting an
  -- amount/repayment entered under a misleading denomination. Legacy groups
  -- whose entries never had currencies remain fully compatible.
  if exists (
    select 1
    from jsonb_array_elements(p_document->'expenses') incoming(value)
    join jsonb_array_elements(existing.document->'expenses') previous(value)
      on previous.value->>'id' = incoming.value->>'id'
    where not (incoming.value ? 'currency') and previous.value ? 'currency'
  ) or exists (
    select 1
    from jsonb_array_elements(p_document->'settlements') incoming(value)
    join jsonb_array_elements(existing.document->'settlements') previous(value)
      on previous.value->>'id' = incoming.value->>'id'
    where not (incoming.value ? 'currency') and previous.value ? 'currency'
  ) then raise exception 'Please update Fairshare before editing this group.'; end if;
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

