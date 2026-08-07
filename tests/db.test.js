import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getUnsyncedAssets,
  getUnsyncedPhotos,
  getUnsyncedPhotosForAsset,
  getUnsyncedRepairs,
  getUnsyncedRepairComments,
  markAssetSynced,
  markPhotoSynced,
  markRepairSynced,
  markRepairCommentSynced,
  queueAsset,
  queuePhoto,
  queueRepair,
  queueRepairComment,
  removeQueuedPhoto,
  saveDraft,
  getDraft,
  clearDraft,
} from '../src/db.js';

afterEach(async () => {
  // Clear the stores between tests without deleting the database itself —
  // deleteDatabase() blocks on the open connection db.js keeps around,
  // which hangs indefinitely rather than actually closing it.
  // Must track db.js's DB_VERSION: opening at a lower version than the
  // one already open throws VersionError rather than downgrading.
  const STORES = ['assets', 'repairs', 'repairComments', 'photos', 'drafts'];
  const request = indexedDB.open('asset-register', 5);
  const rawDb = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };
  });
  await new Promise((resolve, reject) => {
    const tx = rawDb.transaction(STORES, 'readwrite');
    for (const store of STORES) {
      tx.objectStore(store).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  rawDb.close();
});

describe('offline asset queue', () => {
  it('queues an asset as unsynced', async () => {
    await queueAsset({ id: '1', description: 'Office chair' });

    const pending = await getUnsyncedAssets();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: '1', description: 'Office chair', synced: false });
  });

  it('removes an asset from the pending list once marked synced', async () => {
    await queueAsset({ id: '1', description: 'Office chair' });
    await markAssetSynced('1');

    expect(await getUnsyncedAssets()).toHaveLength(0);
  });

  it('tracks multiple queued assets independently', async () => {
    await queueAsset({ id: '1', description: 'Office chair' });
    await queueAsset({ id: '2', description: 'Standing desk' });
    await markAssetSynced('1');

    const pending = await getUnsyncedAssets();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('2');
  });
});

describe('offline repair queue', () => {
  it('queues a repair as unsynced', async () => {
    await queueRepair({ id: 'r1', assetId: '1', description: 'Armrest cracked' });

    const pending = await getUnsyncedRepairs();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: 'r1',
      assetId: '1',
      description: 'Armrest cracked',
      synced: false,
    });
  });

  it('removes a repair from the pending list once marked synced', async () => {
    await queueRepair({ id: 'r1', assetId: '1', description: 'Armrest cracked' });
    await markRepairSynced('r1');

    expect(await getUnsyncedRepairs()).toHaveLength(0);
  });

  it('keeps the asset and repair queues independent', async () => {
    await queueAsset({ id: '1', description: 'Office chair' });
    await queueRepair({ id: 'r1', assetId: '1', description: 'Armrest cracked' });
    await markAssetSynced('1');

    expect(await getUnsyncedAssets()).toHaveLength(0);
    expect(await getUnsyncedRepairs()).toHaveLength(1);
  });
});

describe('offline repair comment queue', () => {
  it('queues a repair comment as unsynced', async () => {
    await queueRepairComment({ id: 'c1', repairId: 'r1', comment: 'Replaced the bolt.' });

    const pending = await getUnsyncedRepairComments();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: 'c1',
      repairId: 'r1',
      comment: 'Replaced the bolt.',
      synced: false,
    });
  });

  it('removes a repair comment from the pending list once marked synced', async () => {
    await queueRepairComment({ id: 'c1', repairId: 'r1', comment: 'Replaced the bolt.' });
    await markRepairCommentSynced('c1');

    expect(await getUnsyncedRepairComments()).toHaveLength(0);
  });

  it('keeps the repair and repair comment queues independent', async () => {
    await queueRepair({ id: 'r1', assetId: '1', description: 'Armrest cracked' });
    await queueRepairComment({ id: 'c1', repairId: 'r1', comment: 'Replaced the bolt.' });
    await markRepairSynced('r1');

    expect(await getUnsyncedRepairs()).toHaveLength(0);
    expect(await getUnsyncedRepairComments()).toHaveLength(1);
  });
});

describe('offline photo queue', () => {
  it('queues photos as unsynced and keeps them per asset', async () => {
    await queuePhoto({ id: 'p1', assetId: 'a1', storagePath: 'u/1.jpg', position: 1 });
    await queuePhoto({ id: 'p2', assetId: 'a1', storagePath: 'u/2.jpg', position: 2 });
    await queuePhoto({ id: 'p3', assetId: 'a2', storagePath: 'u/3.jpg', position: 1 });

    expect(await getUnsyncedPhotos()).toHaveLength(3);

    const forA1 = await getUnsyncedPhotosForAsset('a1');
    expect(forA1.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('removes a photo from the pending list once marked synced', async () => {
    await queuePhoto({ id: 'p1', assetId: 'a1', storagePath: 'u/1.jpg', position: 1 });
    await markPhotoSynced('p1');

    expect(await getUnsyncedPhotos()).toHaveLength(0);
  });

  // Dropping a photo that never reached the server is purely local -
  // no row to delete and no Storage object to remove, so it works with
  // no connection at all.
  it('drops a queued photo without any network involvement', async () => {
    await queuePhoto({ id: 'p1', assetId: 'a1', storagePath: 'u/1.jpg', position: 1 });
    await queuePhoto({ id: 'p2', assetId: 'a1', storagePath: 'u/2.jpg', position: 2 });

    await removeQueuedPhoto('p1');

    const remaining = await getUnsyncedPhotos();
    expect(remaining.map((p) => p.id)).toEqual(['p2']);
  });

  it('keeps the asset and photo queues independent', async () => {
    await queueAsset({ id: 'a1', description: 'Chair' });
    await queuePhoto({ id: 'p1', assetId: 'a1', storagePath: 'u/1.jpg', position: 1 });

    await markPhotoSynced('p1');

    expect(await getUnsyncedPhotos()).toHaveLength(0);
    expect(await getUnsyncedAssets()).toHaveLength(1);
  });
});

// Drafts are in-progress form state, not a queued mutation - see the
// comment in db.js. They exist so a capture form survives the page being
// destroyed underneath it (issue #105, Android returning from the camera).
describe('drafts', () => {
  it('round-trips a draft, blobs included', async () => {
    const blob = new Blob(['photo bytes'], { type: 'image/jpeg' });
    await saveDraft('capture', { assetName: 'Fence post', photos: [{ localId: 'p1', blob }] });

    const draft = await getDraft('capture');
    expect(draft.assetName).toBe('Fence post');
    // The Blob is the reason this is IndexedDB and not localStorage.
    expect(draft.photos[0].blob).toBeInstanceOf(Blob);
    expect(await draft.photos[0].blob.text()).toBe('photo bytes');
  });

  it('returns null when there is no draft', async () => {
    expect(await getDraft('capture')).toBeNull();
  });

  it('overwrites rather than accumulating', async () => {
    await saveDraft('capture', { assetName: 'First' });
    await saveDraft('capture', { assetName: 'Second' });
    expect((await getDraft('capture')).assetName).toBe('Second');
  });

  it('clears', async () => {
    await saveDraft('capture', { assetName: 'Gone soon' });
    await clearDraft('capture');
    expect(await getDraft('capture')).toBeNull();
  });

  it('clearing a draft that was never saved is not an error', async () => {
    await expect(clearDraft('capture')).resolves.toBeUndefined();
  });

  // The whole point is surviving a reload, so it must not be filtered out
  // by the synced flag the queue stores use.
  it('is not returned by any of the sync queues', async () => {
    await saveDraft('capture', { assetName: 'Draft only' });
    expect(await getUnsyncedAssets()).toEqual([]);
    expect(await getUnsyncedPhotos()).toEqual([]);
  });
});
