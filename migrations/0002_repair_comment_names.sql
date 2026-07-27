-- Issue #46 migration — run in the Supabase SQL editor.
-- Reversible via: alter table repair_comments drop column created_by_name;

alter table repair_comments add column created_by_name text;

-- Best-effort backfill: existing comments only have created_by_email, so
-- this recovers a display name for any of them whose author has since set
-- one, by matching that email to an auth.users row and then to profiles.
-- Comments from an account that still has no name stay null, which is
-- correct - the UI falls back to created_by_email for those.
update repair_comments rc
set created_by_name = trim(both ' ' from (p.first_name || ' ' || p.last_name))
from auth.users u
join profiles p on p.id = u.id
where u.email = rc.created_by_email
  and p.first_name is not null
  and p.last_name is not null
  and rc.created_by_name is null;
