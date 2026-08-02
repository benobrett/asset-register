-- Issue #84 (phase 1) migration — run in the Supabase SQL editor.
-- Reversible via: drop table asset_photos;
--
-- IMPORTANT: this moves *rows*, not files. Every object already in the
-- asset-photos Storage bucket stays exactly where it is; only the
-- database's reference to it changes. Nothing here copies or re-uploads
-- storage objects.

-- uuid (not identity) so the client can generate the id offline the same
-- way it does for assets and repairs, with no reconciliation step once it
-- syncs. position is a sort key, not a count: removing a photo leaves a
-- gap rather than renumbering the rest (see CLAUDE.md), so it isn't
-- unique and isn't expected to be contiguous.
create table asset_photos (
  id uuid primary key default gen_random_uuid(),
  -- on delete cascade, same as asset_repairs: deleting an asset drops
  -- its photo rows with it at the DB level. Note this leaves the Storage
  -- objects behind - see the orphaned-file limitation in CLAUDE.md.
  asset_id uuid references assets(id) on delete cascade not null,
  storage_path text not null,
  position integer not null default 1,
  created_at timestamptz not null default now()
);

create index asset_photos_asset_id_idx on asset_photos (asset_id);

alter table asset_photos enable row level security;

-- Same shared-register policy as assets/repairs/comments, not the
-- per-user profiles pattern. `for all` covers delete explicitly, which
-- phase 3 (removing a photo from a saved asset) needs to work at all.
create policy "Logged-in users can manage all asset photos"
  on asset_photos for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Backfill: one row per asset that already has a photo. Idempotent, so
-- re-running this migration can't produce duplicates.
insert into asset_photos (asset_id, storage_path, position, created_at)
select a.id, a.photo_path, 1, a.created_at
from assets a
where a.photo_path is not null
  and not exists (select 1 from asset_photos p where p.asset_id = a.id);

-- assets.photo_path is deliberately NOT dropped here. The app shell is
-- service-worker cached, so clients can still be running the previous
-- version for some time after deploy, and that version reads this
-- column - dropping it would break them in the field with no obvious
-- cause. Dropping it is a follow-up issue, once clients have updated.
