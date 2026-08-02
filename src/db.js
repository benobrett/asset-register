// IndexedDB offline queue — see CLAUDE.md "Offline strategy". Every save
// lands here first (Blob and all), tagged synced: false, keyed by the same
// client-generated UUID that Supabase will use as the row id. Assets and
// repairs are separate stores since they sync to separate tables.

import { openDB } from 'idb';

const DB_NAME = 'asset-register';
const DB_VERSION = 4;
const ASSET_STORE = 'assets';
const REPAIR_STORE = 'repairs';
const REPAIR_COMMENT_STORE = 'repairComments';
// Photos are their own store rather than an array inside the queued
// asset: they also have to be addable to an asset that synced long ago,
// which a field nested in the asset record couldn't represent.
const PHOTO_STORE = 'photos';

let dbPromise;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore(ASSET_STORE, { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          db.createObjectStore(REPAIR_STORE, { keyPath: 'id' });
        }
        if (oldVersion < 3) {
          db.createObjectStore(REPAIR_COMMENT_STORE, { keyPath: 'id' });
        }
        if (oldVersion < 4) {
          db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        }
      },
      // Without this, a stale tab left open from before a DB_VERSION bump
      // holds the old connection open, and this tab's openDB() call just
      // hangs waiting for it to close - no error, no timeout, nothing.
      // Closing our own end here lets whichever tab is actually upgrading
      // proceed instead of blocking forever.
      blocking() {
        dbPromise.then((db) => db.close());
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export async function queueAsset(record) {
  const db = await getDb();
  await db.put(ASSET_STORE, { ...record, synced: false });
}

export async function getUnsyncedAssets() {
  const db = await getDb();
  const all = await db.getAll(ASSET_STORE);
  return all.filter((asset) => !asset.synced);
}

export async function markAssetSynced(id) {
  const db = await getDb();
  await db.delete(ASSET_STORE, id);
}

// Shape: { id, assetId, storagePath, position, blob }. The Blob rides
// along in IndexedDB (it stores them directly), so a photo captured with
// no signal survives until there's a connection to upload it to.
export async function queuePhoto(record) {
  const db = await getDb();
  await db.put(PHOTO_STORE, { ...record, synced: false });
}

export async function getUnsyncedPhotos() {
  const db = await getDb();
  const all = await db.getAll(PHOTO_STORE);
  return all.filter((photo) => !photo.synced);
}

export async function getUnsyncedPhotosForAsset(assetId) {
  const all = await getUnsyncedPhotos();
  return all.filter((photo) => photo.assetId === assetId);
}

export async function markPhotoSynced(id) {
  const db = await getDb();
  await db.delete(PHOTO_STORE, id);
}

// Dropping a photo that never reached the server is purely local - no
// row to delete, no Storage object to remove, so it works offline.
export async function removeQueuedPhoto(id) {
  const db = await getDb();
  await db.delete(PHOTO_STORE, id);
}

export async function queueRepair(record) {
  const db = await getDb();
  await db.put(REPAIR_STORE, { ...record, synced: false });
}

export async function getUnsyncedRepairs() {
  const db = await getDb();
  const all = await db.getAll(REPAIR_STORE);
  return all.filter((repair) => !repair.synced);
}

export async function markRepairSynced(id) {
  const db = await getDb();
  await db.delete(REPAIR_STORE, id);
}

export async function queueRepairComment(record) {
  const db = await getDb();
  await db.put(REPAIR_COMMENT_STORE, { ...record, synced: false });
}

export async function getUnsyncedRepairComments() {
  const db = await getDb();
  const all = await db.getAll(REPAIR_COMMENT_STORE);
  return all.filter((comment) => !comment.synced);
}

export async function markRepairCommentSynced(id) {
  const db = await getDb();
  await db.delete(REPAIR_COMMENT_STORE, id);
}
