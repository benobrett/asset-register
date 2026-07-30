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
} from '../src/db.js';

afterEach(async () => {
  // Clear the stores between tests without deleting the database itself —
  // deleteDatabase() blocks on the open connection db.js keeps around,
  // which hangs indefinitely rather than actually closing it.
  // Must track db.js's DB_VERSION: opening at a lower version than the
  // one already open throws VersionError rather than downgrading.
  const STORES = ['assets', 'repairs', 'repairComments', 'photos'];
  const request = indexedDB.open('asset-register', 4);
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
