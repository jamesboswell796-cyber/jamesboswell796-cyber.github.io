-- v0.3 migration. Run after schema.sql in your own Supabase SQL Editor.
-- Single authenticated transaction, no elevated SECURITY DEFINER access.
-- Grant execute only to authenticated; normal per-user RLS remains active.
create or replace function public.hub_apply_batch(p_changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  step jsonb;
  payload jsonb;
  what text;
  key text;
  expected integer;
  old_row public.hub_items%rowtype;
  changed public.hub_items%rowtype;
  output jsonb := '[]'::jsonb;
  seen text[] := array[]::text[];
begin
  if uid is null then raise exception 'Please sign in' using errcode='28000'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 2000 then
    raise exception 'Invalid batch size';
  end if;
  for step in select value from jsonb_array_elements(p_changes) loop
    what := step->>'action'; key := step->>'id';payload := step->'record';
    if what not in ('create','update','delete') or key is null or length(key) not between 1 and 128 or key = any(seen) then
      raise exception 'Invalid action or duplicated ID';
    end if;
    seen := array_append(seen,key);
    if what = 'create' then
      if jsonb_typeof(payload) <> 'object' then raise exception 'Missing record'; end if;
      insert into public.hub_items(user_id,id,kind,title,summary,body,entry_url,current_url,starred,pinned)
      values(uid,key,payload->>'kind',payload->>'title',coalesce(payload->>'summary',''),coalesce(payload->>'body',''),
        coalesce(payload->>'entry_url',''),coalesce(payload->>'current_url',''),
        coalesce((payload->>'starred')::boolean,false),coalesce((payload->>'pinned')::boolean,false))
      returning * into changed;
    else
      if (step->>'base_revision') !~ '^[1-9][0-9]*$' then raise exception 'Missing revision'; end if;
      expected := (step->>'base_revision')::integer;
      select * into old_row from public.hub_items where user_id=uid and id=key for update;
      if not found or old_row.revision <> expected then
        raise exception 'The record changed since preview; the entire batch was cancelled';
      end if;
      if what = 'delete' then
        delete from public.hub_items where user_id=uid and id=key;
        changed := null;
      else
        if jsonb_typeof(payload) <> 'object' then raise exception 'Missing record'; end if;
        update public.hub_items set kind=payload->>'kind',title=payload->>'title',
          summary=coalesce(payload->>'summary',''),body=coalesce(payload->>'body',''),
          entry_url=coalesce(payload->>'entry_url',''),current_url=coalesce(payload->>'current_url',''),
          starred=coalesce((payload->>'starred')::boolean,false),
          pinned=coalesce((payload->>'pinned')::boolean,false)
        where user_id=uid and id=key returning * into changed;
      end if;
    end if;
    output := output || jsonb_build_array(jsonb_build_object('action',what,'id',key,'row',to_jsonb(changed)));
  end loop;
  return output;
end; $$;
revoke all on function public.hub_apply_batch(jsonb) from public, anon;
grant execute on function public.hub_apply_batch(jsonb) to authenticated;
