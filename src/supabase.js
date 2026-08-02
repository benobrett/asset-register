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
// four. Returns a Map of path -> signed URL; a path that couldn't be
// signed is simply absent rather than throwing, so one bad row can't
// stop the rest of an asset's photos from displaying.
export async function getPhotoUrls(photoPaths, expiresInSeconds = 3600) {
  const paths = [...new Set((photoPaths ?? []).filter(Boolean))];
  if (!paths.length) return new Map();

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  if (error) throw error;

  return new Map(
    (data ?? [])
      .filter((entry) => entry.signedUrl && !entry.error)
      .map((entry) => [entry.path, entry.signedUrl])
  );
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
