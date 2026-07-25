create table assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  location text,
  condition text check (condition in ('good', 'fair', 'poor', 'damaged')),
  serial_number text,
  notes text,
  photo_path text,                          -- object path in Supabase Storage
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  location text,
  condition text check (condition in ('good', 'fair', 'poor', 'damaged')),
  serial_number text,
  notes text,
  photo_path text,                          -- object path in Supabase Storage
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);