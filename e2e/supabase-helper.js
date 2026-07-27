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
