// Pushes queued records/photos to Supabase on reconnect — see CLAUDE.md
// "Offline strategy". Failures are left queued rather than thrown, since a
// dropped connection mid-sync is an expected condition, not an error.

import { supabase, PHOTO_BUCKET } from './supabase.js';
import {
  getUnsyncedAssets,
  getUnsyncedPhotos,
  getUnsyncedRepairs,
  getUnsyncedRepairComments,
  markAssetSynced,
  markPhotoSynced,
  markRepairSynced,
  markRepairCommentSynced,
} from './db.js';

export async function syncQueuedAssets() {
  const pending = await getUnsyncedAssets();
  const succeeded = [];
  const failed = [];

  for (const asset of pending) {
    try {
      // Legacy shape only. Assets queued since multiple photos shipped
      // carry no blob of their own - their photos are separate records in
      // the photo queue - but a record captured before that upgrade is
      // still sitting in IndexedDB with one attached, and the app shell
      // is service-worker cached, so those can surface well after a
      // deploy. Upload it, and give it an asset_photos row too, or it
      // would reach Storage without anything pointing at it.
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
        // ?? null, not asset.condition directly - a record queued before
        // this field existed (the app shell is service-worker cached, so
        // an old queued record can still be sitting on a device when new
        // code loads) has no condition/conditionNote property at all,
        // and this treats that the same as a deliberately unset one
        // rather than writing undefined into the insert.
        condition: asset.condition ?? null,
        condition_note: asset.conditionNote ?? null,
      });
      if (insertError) throw insertError;

      // Second half of the legacy path above: without this the photo
      // would upload and the asset would save, but nothing would list it
      // once the app reads photos from asset_photos.
      if (asset.photo && asset.photoPath) {
        const { error: photoRowError } = await supabase
          .from('asset_photos')
          .upsert({ asset_id: asset.id, storage_path: asset.photoPath, position: 1 });
        if (photoRowError) throw photoRowError;
      }

      await markAssetSynced(asset.id);
      succeeded.push(asset.id);
    } catch (err) {
      failed.push({ id: asset.id, error: err.message || String(err) });
    }
  }

  return { succeeded, failed };
}

export async function syncQueuedPhotos() {
  const pending = await getUnsyncedPhotos();
  const succeeded = [];
  const failed = [];

  for (const photo of pending) {
    try {
      // Storage first, then the row that points at it. The other order
      // would briefly leave a row referencing an object that isn't there
      // yet, which renders as a broken image.
      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(photo.storagePath, photo.blob, { upsert: true });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from('asset_photos').upsert({
        id: photo.id,
        asset_id: photo.assetId,
        storage_path: photo.storagePath,
        position: photo.position ?? 1,
      });
      if (insertError) throw insertError;

      await markPhotoSynced(photo.id);
      succeeded.push(photo.id);
    } catch (err) {
      failed.push({ id: photo.id, error: err.message || String(err) });
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
        created_by_email: repair.createdByEmail,
        updated_at: repair.updatedAt ?? null,
        updated_by_email: repair.updatedByEmail ?? null,
        completed_by_email: repair.completedByEmail ?? null,
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

export async function syncQueuedRepairComments() {
  const pending = await getUnsyncedRepairComments();
  const succeeded = [];
  const failed = [];

  for (const comment of pending) {
    try {
      const { error } = await supabase.from('repair_comments').upsert({
        id: comment.id,
        repair_id: comment.repairId,
        comment: comment.comment,
        created_by_email: comment.createdByEmail,
        created_by_name: comment.createdByName ?? null,
      });
      if (error) throw error;

      await markRepairCommentSynced(comment.id);
      succeeded.push(comment.id);
    } catch (err) {
      failed.push({ id: comment.id, error: err.message || String(err) });
    }
  }

  return { succeeded, failed };
}

// Assets, then photos, then repairs, then repair comments. Each step
// references a row created by an earlier one as a foreign key, so
// syncing out of order would fail: photos and repairs both reference an
// asset, and a comment references a repair. Photos sit directly after
// assets because that's the only thing they depend on.
export async function syncAll() {
  const assets = await syncQueuedAssets();
  const photos = await syncQueuedPhotos();
  const repairs = await syncQueuedRepairs();
  const repairComments = await syncQueuedRepairComments();
  return { assets, photos, repairs, repairComments };
}

export function watchConnectivity() {
  window.addEventListener('online', () => {
    syncAll();
  });
}
