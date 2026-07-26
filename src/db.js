// IndexedDB offline queue — see CLAUDE.md "Offline strategy". Every save
// lands here first (Blob and all), tagged synced: false, keyed by the same
// client-generated UUID that Supabase will use as the row id. Assets and
// repairs are separate stores since they sync to separate tables.

import { openDB } from 'idb';

const DB_NAME = 'asset-register';
const DB_VERSION = 3;
const ASSET_STORE = 'assets';
const REPAIR_STORE = 'repairs';
const REPAIR_COMMENT_STORE = 'repairComments';

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
