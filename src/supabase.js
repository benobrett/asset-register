import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — check your .env file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export const PHOTO_BUCKET = 'asset-photos';

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
