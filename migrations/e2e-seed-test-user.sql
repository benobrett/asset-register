-- One-off data setup for the e2e Supabase project only (not a schema
-- migration, and not for the production project) - run in the e2e
-- project's SQL editor after creating the test user via the dashboard
-- (Authentication -> Users -> Create new user, with Auto Confirm).
--
-- The dashboard "Create new user" path still fires the handle_new_user
-- trigger, which creates this account's profiles row - but with null
-- names, since there's no signup form metadata to read them from. That
-- would send the e2e login spec straight to the #/complete-profile
-- prompt instead of #/register. This fills the name in directly.
--
-- Replace THE_TEST_ACCOUNT_EMAIL below with the actual address used.

-- Check first:
select p.id, p.first_name, p.last_name
from profiles p
join auth.users u on u.id = p.id
where u.email = 'THE_TEST_ACCOUNT_EMAIL';

-- If first_name/last_name came back null, run this:
update profiles
set first_name = 'Test', last_name = 'User'
where id = (select id from auth.users where email = 'THE_TEST_ACCOUNT_EMAIL');
