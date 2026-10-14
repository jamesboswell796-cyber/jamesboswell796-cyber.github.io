-- Execute ONCE in Supabase SQL Editor. Use the project's public anon key in config.js;
-- never place service_role or database credentials in a published static site.
create extension if not exists pgcrypto;
create table if not exists public.hub_items (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('project','prompt')),
  title text not null check (length(trim(title)) between 1 and 160),
  summary text not null default '',
  body text not null default '',
  entry_url text not null default '',
  current_url text not null default '',
  starred boolean not null default false,
  pinned boolean not null default false,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists hub_items_user_updated on public.hub_items(user_id,updated_at desc);
create or replace function public.hub_item_revision() returns trigger language plpgsql as $$
begin
  new.user_id := old.user_id;
  new.revision := old.revision + 1;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists hub_items_revision_trigger on public.hub_items;
create trigger hub_items_revision_trigger before update on public.hub_items
for each row execute function public.hub_item_revision();
alter table public.hub_items enable row level security;
revoke all on public.hub_items from anon;
grant select,insert,update,delete on public.hub_items to authenticated;
drop policy if exists "owner select" on public.hub_items;
drop policy if exists "owner insert" on public.hub_items;
drop policy if exists "owner update" on public.hub_items;
drop policy if exists "owner delete" on public.hub_items;
create policy "owner select" on public.hub_items for select to authenticated using (auth.uid()=user_id);
create policy "owner insert" on public.hub_items for insert to authenticated with check (auth.uid()=user_id);
create policy "owner update" on public.hub_items for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "owner delete" on public.hub_items for delete to authenticated using (auth.uid()=user_id);
