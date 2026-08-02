-- 0005: drop assets.photo_path, superseded by the asset_photos table.
--
-- 0004 added asset_photos and backfilled it from this column, but left the
-- column in place and the app kept writing it. That was for one reason
-- only: the app shell is service-worker cached, so clients running the
-- pre-multi-photo build persist for a while after a deploy, and that build
-- reads assets.photo_path knowing nothing of asset_photos.
--
-- RUN THIS ONLY ONCE THOSE CLIENTS HAVE UPDATED. It is not a soft
-- degradation for one that hasn't: the old detail view names photo_path
-- explicitly in its select list, and PostgREST answers an unknown column
-- with a 400 - so that whole screen breaks, not just its image. The app
-- registers its service worker with autoUpdate, so any client that opens
-- the app with a connection has already taken the new build; the exposure
-- is a device that has been offline continuously since before the
-- multi-photo deploy.
--
-- Safe to re-run.

-- Belt and braces: 0004's backfill should already have given every
-- photo_path an asset_photos row, but this is the last moment the column
-- exists to check it from. on conflict do nothing, because a row for the
-- same asset+path may well be there already.
insert into public.asset_photos (asset_id, storage_path, position, created_at)
select a.id, a.photo_path, 1, a.created_at from public.assets a where a.photo_path is not null and not exists (select 1 from public.asset_photos p where p.asset_id = a.id and p.storage_path = a.photo_path) on conflict do nothing;

alter table public.assets drop column if exists photo_path;
