-- Run in the e2e Supabase project's SQL editor (not production - this
-- already exists there, just never documented until now).
-- Requires the asset-photos bucket to already exist (Storage -> New
-- bucket -> name it exactly "asset-photos", leave it private).
--
-- Without this, uploads fail with "new row violates row-level security
-- policy" (403) - creating a bucket grants no access by default; Storage
-- policies live on storage.objects and are separate from the table
-- policies in schema.sql.

create policy "Logged-in users can manage asset photos"
  on storage.objects for all
  using (bucket_id = 'asset-photos' and auth.uid() is not null)
  with check (bucket_id = 'asset-photos' and auth.uid() is not null);
