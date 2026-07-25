// IndexedDB offline queue — see CLAUDE.md "Offline strategy". Every save
// lands here first (Blob and all), tagged synced: false, keyed by the same
// client-generated UUID that Supabase will use as the row id.

import { openDB } from 'idb';

const DB_NAME = 'asset-register';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

let dbPromise;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function queueAsset(record) {
  const db = await getDb();
  await db.put(STORE_NAME, { ...record, synced: false });
}

export async function getUnsyncedAssets() {
  const db = await getDb();
  const all = await db.getAll(STORE_NAME);
  return all.filter((asset) => !asset.synced);
}

export async function markAssetSynced(id) {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}
