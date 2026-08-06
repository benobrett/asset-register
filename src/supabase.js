import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — check your .env file.'
  );
}

// PKCE (not the default implicit flow) so the password recovery link
// returns its code as a query param (?code=...) rather than a URL
// fragment (#access_token=...) - the fragment form collides directly
// with this app's hash-based router, since #/reset-password and
// #access_token=...&type=recovery can't both be the URL's hash at once.
// This is client-wide: it also governs the signup confirmation flow, so
// re-test that after touching this.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { flowType: 'pkce' },
});

export const PHOTO_BUCKET = 'asset-photos';

// Batched, so an asset with four photos costs one round trip instead of
// four. One path that can't be signed never stops the rest displaying.
//
// Returns { urls, unavailable } rather than just a Map. It used to return
// only the Map, silently dropping anything that failed - which meant a
// photo the database still knows about vanished from the screen, looking
// exactly like an asset that never had one. That is how issue #97 went
// unnoticed: a Storage permission failure and "no photos yet" were
// indistinguishable, so nobody could report what they couldn't see. The
// caller now gets the failures too and can say so.
export async function getPhotoUrls(photoPaths, expiresInSeconds = 3600) {
  const paths = [...new Set((photoPaths ?? []).filter(Boolean))];
  if (!paths.length) return { urls: new Map(), unavailable: [] };

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  // A whole-request failure: nothing could be signed, so every path is
  // unavailable rather than the screen losing its photos with no
  // explanation.
  if (error) {
    console.error('Could not sign any photo URLs:', error);
    return { urls: new Map(), unavailable: paths };
  }

  const urls = new Map();
  const unavailable = [];
  for (const entry of data ?? []) {
    if (entry.signedUrl && !entry.error) {
      urls.set(entry.path, entry.signedUrl);
    } else {
      // Per-path. Supabase reports a missing object and an object you
      // aren't allowed to read with the same message, deliberately - so
      // this can't tell "deleted" from "denied", and the UI shouldn't
      // claim to either. The console keeps the detail for diagnosis.
      console.error('Could not sign photo URL:', entry.path, entry.error);
      unavailable.push(entry.path);
    }
  }
  return { urls, unavailable };
}

// Bucket isn't public (RLS gates everything else on login), so photos
// are served via short-lived signed URLs rather than a public URL.
export async function getPhotoUrl(photoPath, expiresInSeconds = 3600) {
  if (!photoPath) return null;
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(photoPath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
