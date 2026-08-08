-- 0008: create the asset-photos Storage bucket that production never had.
--
-- Found on 2026-08-08, within an hour of applying 0007. 0007 recorded
-- production's state as "RLS enabled on storage.objects, zero policies".
-- Both true, and both beside the point:
--
--   select id, name, public from storage.buckets;  -> 0 rows
--
-- There was no bucket. The policy 0007 creates was guarding nothing, and
-- uploads kept failing after it was applied - which is how this was
-- finally caught, since the obvious next step after "policy created" was
-- to check whether photos arrived, and they still didn't.
--
-- schema.sql has described this bucket's access rules since the
-- multi-photo work without ever declaring the bucket itself. It existed
-- only on the e2e project, created by hand there, so the Playwright suite
-- asserted photos reach Storage and passed throughout.
--
-- Postgres will not warn you about this. A policy on storage.objects
-- naming a bucket_id that no bucket has is accepted without complaint, so
-- run this BEFORE 0007 on any new project.
--
-- It stayed invisible for the same reason #97 did: syncQueuedPhotos()
-- leaves a failed upload in the IndexedDB queue - correct for a dropped
-- connection, indistinguishable from a refusal - and detail.js renders
-- queued photos from their local blob. The photo is visible forever to
-- the device that took it and to nobody else. Five real captures were
-- stranded that way on one phone; all five synced within seconds of the
-- bucket existing, having been invisible to every other user since they
-- were taken.
--
-- Safe to re-run. The bucket must stay PRIVATE: a public bucket makes
-- every photo readable by anyone holding the URL and makes the signed-URL
-- mechanism in src/supabase.js pointless. The second statement re-asserts
-- that rather than trusting it, since flipping it is one dashboard toggle.

insert into storage.buckets (id, name, public) values ('asset-photos', 'asset-photos', false) on conflict (id) do nothing;

update storage.buckets set public = false where id = 'asset-photos';

-- Verify - should return one row, and public must be false:
--   select id, name, public from storage.buckets where id = 'asset-photos';
