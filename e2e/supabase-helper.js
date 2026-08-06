import { createClient } from '@supabase/supabase-js';

// A Node-side Supabase client, separate from the browser's - used to assert
// a record genuinely reached the server (not just that the UI shows it,
// which could be true from local/IndexedDB state alone) and to clean up
// what a spec created. Signed in as the same test account so RLS
// ("logged-in users can manage all assets/repairs/comments") allows it
// through; a plain anon client would get zero rows back.
export async function createTestSupabaseClient() {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  );
  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.E2E_TEST_EMAIL,
    password: process.env.E2E_TEST_PASSWORD,
  });
  if (error) throw error;
  return supabase;
}

// A client signed in as a *different* account, for asserting that this is
// genuinely a shared register rather than one that merely looks right to
// whoever created the record. Issue #97 was exactly that failure: with no
// Storage policy, uploads 403'd, photos stayed in the uploader's own
// IndexedDB queue and rendered from the local blob, so the app looked
// correct to the one person who could never have noticed.
//
// It reuses E2E_INCOMPLETE_PROFILE_*, the account deliberately left with
// no name on file for the #/complete-profile gate. That is fine here and
// only here, because this client never touches the UI or the profiles
// table - it reads and writes assets/repairs/comments/Storage over the
// API. **Never drive the app's complete-profile form as this account**:
// setting its name is permanent and no client-side call can undo it, and
// auth-gates.spec.js depends on it staying nameless.
export async function createSecondUserClient() {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  );
  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.E2E_INCOMPLETE_PROFILE_EMAIL,
    password: process.env.E2E_INCOMPLETE_PROFILE_PASSWORD,
  });
  if (error) throw error;
  return supabase;
}
