// Pushes queued records/photos to Supabase on reconnect — see CLAUDE.md
// "Offline strategy". Failures are left queued rather than thrown, since a
// dropped connection mid-sync is an expected condition, not an error.

import { supabase, PHOTO_BUCKET } from './supabase.js';
import {
  getUnsyncedAssets,
  getUnsyncedRepairs,
  markAssetSynced,
  markRepairSynced,
} from './db.js';

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

export async function syncQueuedRepairs() {
  const pending = await getUnsyncedRepairs();
  const succeeded = [];
  const failed = [];

  for (const repair of pending) {
    try {
      const { error } = await supabase.from('asset_repairs').upsert({
        id: repair.id,
        asset_id: repair.assetId,
        description: repair.description,
        reported_at: repair.reportedAt,
        completed_at: repair.completedAt,
      });
      if (error) throw error;

      await markRepairSynced(repair.id);
      succeeded.push(repair.id);
    } catch (err) {
      failed.push({ id: repair.id, error: err.message || String(err) });
    }
  }

  return { succeeded, failed };
}

// Assets must sync before repairs — asset_repairs.asset_id is a foreign key,
// so a repair queued against an asset that hasn't synced yet would fail.
export async function syncAll() {
  const assets = await syncQueuedAssets();
  const repairs = await syncQueuedRepairs();
  return { assets, repairs };
}

export function watchConnectivity() {
  window.addEventListener('online', () => {
    syncAll();
  });
}
