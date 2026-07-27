import { supabase } from './supabase.js';

export async function signUp(email, password, firstName, lastName) {
  // Without emailRedirectTo, Supabase falls back to the dashboard's single
  // "Site URL" setting for the confirmation link - fine if that happens to
  // match wherever signup was tested last, but wrong the moment there's
  // more than one environment (local dev vs. the deployed GitHub Pages
  // URL). This targets wherever the app is actually running instead.
  //
  // first_name/last_name go in as user metadata rather than a direct
  // profiles insert: there's no session yet at signup time (the account
  // isn't confirmed), so RLS would block a client-side insert. A
  // SECURITY DEFINER trigger (see schema.sql) reads this metadata off
  // auth.users and creates the profiles row itself once the account
  // actually exists.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
      data: {
        first_name: firstName,
        last_name: lastName,
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

export function onAuthChange(callback) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => subscription.unsubscribe();
}

export async function getProfile() {
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  // null for a pre-trigger legacy account that has no row at all yet -
  // treated the same as a row with null names by needsNamePrompt().
  return data;
}

// A profile with no row at all (legacy account, predates this feature)
// is treated the same as one with null names - both need the prompt.
export function needsNamePrompt(profile) {
  return !profile || !profile.first_name || !profile.last_name;
}

// Cached per session so the routing gate isn't re-querying the profiles
// table on every hash change - reset on sign-in/out so a stale result
// from a previous account can never leak into a new one.
let profileCompleteCache = null;

export async function isProfileComplete() {
  if (profileCompleteCache !== null) return profileCompleteCache;
  try {
    const profile = await getProfile();
    profileCompleteCache = !needsNamePrompt(profile);
  } catch (err) {
    // This is an onboarding nicety, not an access control check - a
    // failed query here (network blip, migration not yet applied)
    // should never be the thing that locks a field worker out of the
    // whole app. Fail open: don't cache the failure, just let them
    // through and try again next navigation.
    console.error('Could not check profile completeness:', err);
    return true;
  }
  return profileCompleteCache;
}

// Called right after a successful submitProfileName() so the gate lets
// the user through immediately, without waiting on a fresh query that
// would just re-confirm what the view already knows just succeeded.
export function markProfileComplete() {
  profileCompleteCache = true;
}

export function resetProfileCache() {
  profileCompleteCache = null;
}

export async function submitProfileName(firstName, lastName) {
  const session = await getSession();
  if (!session) throw new Error('Not signed in.');
  const userId = session.user.id;

  const { error: insertError } = await supabase
    .from('profiles')
    .insert({ id: userId, first_name: firstName, last_name: lastName });
  if (!insertError) return;

  // 23505 = unique_violation - a row already exists for this account
  // (created by the signup trigger, or from an earlier partial attempt),
  // so fall back to updating it instead of treating this as a failure.
  if (insertError.code !== '23505') throw insertError;

  const { data, error: updateError } = await supabase
    .from('profiles')
    .update({ first_name: firstName, last_name: lastName })
    .eq('id', userId)
    .select();
  if (updateError) throw updateError;

  // The update-policy's RLS only allows this when both names are still
  // null; if they're already set, the row is silently filtered out
  // rather than raising an error, so zero rows back means it was blocked.
  if (!data || data.length === 0) {
    throw new Error('This account already has a name on file.');
  }
}
