-- Issue #44 migration — run in the Supabase SQL editor.
-- Reversible via:
--   drop trigger on_auth_user_created on auth.users;
--   drop function handle_new_user();
--   drop table profiles;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  check (first_name is null or (first_name = btrim(first_name) and length(first_name) between 1 and 50 and first_name ~ ('^[[:alpha:][:space:]' || chr(39) || '-]+$'))),
  check (last_name is null or (last_name = btrim(last_name) and length(last_name) between 1 and 50 and last_name ~ ('^[[:alpha:][:space:]' || chr(39) || '-]+$')))
);

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();

alter table profiles enable row level security;

create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Users can set their own name once"
  on profiles for update
  using (auth.uid() = id and first_name is null and last_name is null)
  with check (auth.uid() = id);

create index profiles_missing_name_idx on profiles (id) where first_name is null or last_name is null;
