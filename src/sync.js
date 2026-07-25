// Pushes queued records/photos to Supabase on reconnect — see CLAUDE.md
// "Offline strategy". Failures are left queued rather than thrown, since a
// dropped connection mid-sync is an expected condition, not an error.

import { supabase, PHOTO_BUCKET } from './supabase.js';
import { getUnsyncedAssets, markAssetSynced } from './db.js';

export async function syncQueuedAssets() {
  const pending = await getUnsyncedAssets();
  const succeeded = [];
  const failed = [];

  for (const asset of pending) {
    try {
      if (asset.photo && asset.photoPath) {
        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(asset.photoPath, asset.photo, { upsert: true });
        if (uploadError) throw uploadError;
      }

      const { error: insertError } = await supabase.from('assets').upsert({
        id: asset.id,
        asset_name: asset.assetName,
        description: asset.description,
        recorded_at: asset.recordedAt,
        photo_path: asset.photoPath,
        repair_needed: asset.repairNeeded,
        repair_description: asset.repairDescription,
        repair_completed_at: asset.repairCompletedAt,
      });
      if (insertError) throw insertError;

      await markAssetSynced(asset.id);
      succeeded.push(asset.id);
    } catch (err) {
      failed.push({ id: asset.id, error: err.message || String(err) });
    }
  }

  return { succeeded, failed };
}

export function watchConnectivity() {
  window.addEventListener('online', () => {
    syncQueuedAssets();
  });
}
