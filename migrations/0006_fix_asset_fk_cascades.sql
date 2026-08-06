-- 0006: put ON DELETE CASCADE back on the foreign keys that should have
-- had it all along.
--
-- Found the hard way: deleting an asset in production failed with
--   update or delete on table "assets" violates foreign key constraint
--   "asset_repairs_asset_id_fkey" on table "asset_repairs"
-- Deleting an asset is the app's only destructive action (detail.js), so
-- in production it was broken for every asset that had a repair against
-- it. schema.sql has declared this cascade since the beginning; the live
-- database simply never had it.
--
-- Why nothing caught it: asset_repairs predates migrations/, so it was
-- created by hand and schema.sql was written to describe it rather than
-- to create it - the two were never checked against each other. The e2e
-- project was set up later, from schema.sql, so it *does* have the
-- cascade, which is why register-view.spec.js can assert a cascading
-- delete and pass while production is broken. A green e2e suite says
-- nothing about production's schema.
--
-- Measured state of production before this ran (confdeltype, c = cascade,
-- a = no action). The drift is exactly in the two oldest, hand-created
-- tables; everything created by a migration since is correct:
--
--   asset_repairs_asset_id_fkey     -> assets          a   BROKEN
--   asset_comments_asset_id_fkey    -> assets          a   broken, unused
--   asset_photos_asset_id_fkey      -> assets          c   ok (from 0004)
--   repair_comments_repair_id_fkey  -> asset_repairs   c   ok
--
-- The created_by -> auth.users keys are all `a` and must stay that way:
-- deleting a user account must not delete the assets they logged. Do not
-- "fix" those to match.
--
-- Drops and re-adds rather than ALTER-ing: Postgres has no
-- ALTER CONSTRAINT for a foreign key delete rule. Each statement is on
-- one physical line and uses no quote characters (see CLAUDE.md on SQL
-- getting mangled in transit), and IF EXISTS makes the whole thing safe
-- to re-run and safe on a database that already has it right - which the
-- e2e project does. The two already-correct constraints are re-created
-- anyway so the end state is the same wherever this is run.

alter table public.asset_repairs drop constraint if exists asset_repairs_asset_id_fkey;
alter table public.asset_repairs add constraint asset_repairs_asset_id_fkey foreign key (asset_id) references public.assets(id) on delete cascade;

alter table public.repair_comments drop constraint if exists repair_comments_repair_id_fkey;
alter table public.repair_comments add constraint repair_comments_repair_id_fkey foreign key (repair_id) references public.asset_repairs(id) on delete cascade;

alter table public.asset_photos drop constraint if exists asset_photos_asset_id_fkey;
alter table public.asset_photos add constraint asset_photos_asset_id_fkey foreign key (asset_id) references public.assets(id) on delete cascade;

-- asset_comments has never had a cascade, in schema.sql or anywhere else.
-- The table is currently unused (no code under src/ reads or writes it),
-- so it has no rows and cannot be blocking anything today - but the day
-- someone wires it up, deleting an asset breaks exactly the way
-- asset_repairs just did. Fixing it while the table is empty costs
-- nothing.
alter table public.asset_comments drop constraint if exists asset_comments_asset_id_fkey;
alter table public.asset_comments add constraint asset_comments_asset_id_fkey foreign key (asset_id) references public.assets(id) on delete cascade;

-- Verify: every row should show confdeltype = c.
-- select conname, conrelid::regclass, confdeltype from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace order by 1;
