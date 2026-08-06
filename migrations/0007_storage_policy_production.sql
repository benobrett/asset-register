-- 0007: create the asset-photos Storage policy that production never had.
--
-- Root cause of issue #97 ("photos uploaded by one user aren't visible to
-- another"). The real fault was worse than the symptom suggested:
-- production had NO policies on storage.objects at all, with RLS enabled.
--
--   select relrowsecurity from pg_class where oid = 'storage.objects'::regclass;  -> true
--   select count(*) from pg_policies where schemaname = 'storage';                -> 0
--
-- RLS on with no policy denies everything, so every photo upload had been
-- failing with a 403 since the beginning. The production bucket is empty;
-- no photo has ever reached it.
--
-- Why it looked like a visibility bug rather than a total failure:
-- syncQueuedPhotos() catches a failed upload and leaves the photo in the
-- IndexedDB queue - correct behaviour for a dropped connection, which is
-- indistinguishable from a 403 here - and detail.js renders queued photos
-- from their local blob. So the person who took the photo saw it, on their
-- own device, forever. Nobody else could, because it was never anywhere
-- else. Symmetric, and completely silent.
--
-- schema.sql has carried this policy since the multi-photo work, with a
-- comment claiming it "already existed on the production project, set up
-- directly in the dashboard". It did not. Same class of drift as 0006:
-- something described in schema.sql that no one had ever checked against
-- the live database. See CLAUDE.md, and issue #100 for detecting this.
--
-- The e2e project has had the policy all along, from
-- migrations/e2e-storage-policy.sql - which is exactly why the Playwright
-- suite asserts that uploaded photos are downloadable from Storage, and
-- passes, while production was broken.
--
-- Safe to re-run, and safe on e2e (drop if exists, then recreate).
-- Requires the asset-photos bucket to exist and to stay PRIVATE: the fix
-- is authenticated-only access, never a public bucket, which would make
-- every photo readable by anyone with the URL and make the signed-URL
-- mechanism in src/supabase.js pointless.
--
-- `for all` covers select, insert, update and delete deliberately. An
-- owner-scoped delete would break photo removal for anyone who didn't
-- upload the file - the same bug displaced into a different action.

drop policy if exists "Logged-in users can manage asset photos" on storage.objects;

create policy "Logged-in users can manage asset photos" on storage.objects for all using (bucket_id = 'asset-photos' and auth.uid() is not null) with check (bucket_id = 'asset-photos' and auth.uid() is not null);

-- Verify - should return one row, and public must be false:
--   select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects';
--   select name, public from storage.buckets where name = 'asset-photos';
