-- Issue #75 migration — run in the Supabase SQL editor.
-- Reversible via: alter table assets drop column condition, drop column condition_note;

-- Both nullable: every existing asset predates this feature and has no
-- condition - there's no sensible value to backfill, so "not set" has to be
-- a real, representable state, not a fabricated default.
alter table assets add column condition text check (condition in ('good', 'ok', 'poor'));
alter table assets add column condition_note text check (condition_note is null or length(condition_note) <= 200);

-- No RLS change needed - the existing shared policy on assets ("using
-- (auth.uid() is not null)") applies at the row level and already covers
-- these new columns.
