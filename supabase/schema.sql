-- GoSolo customer data with per-user row-level security.
create table if not exists public.user_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  data_key text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, data_key)
);
alter table public.user_data enable row level security;
drop policy if exists "Users read own GoSolo data" on public.user_data;
create policy "Users read own GoSolo data" on public.user_data
for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own GoSolo data" on public.user_data;
create policy "Users insert own GoSolo data" on public.user_data
for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own GoSolo data" on public.user_data;
create policy "Users update own GoSolo data" on public.user_data
for update to authenticated using (auth.uid() = user_id)
with check (auth.uid() = user_id);
drop policy if exists "Users delete own GoSolo data" on public.user_data;
create policy "Users delete own GoSolo data" on public.user_data
for delete to authenticated using (auth.uid() = user_id);
