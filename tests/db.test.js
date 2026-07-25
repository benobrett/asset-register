import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getUnsyncedAssets,
  getUnsyncedRepairs,
  markAssetSynced,
  markRepairSynced,
  queueAsset,
  queueRepair,
} from '../src/db.js';

afterEach(async () => {
  // Clear the stores between tests without deleting the database itself —
  // deleteDatabase() blocks on the open connection db.js keeps around,
  // which hangs indefinitely rather than actually closing it.
  const request = indexedDB.open('asset-register', 2);
  const rawDb = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('repairs')) {
        db.createObjectStore('repairs', { keyPath: 'id' });
      }
    };
  });
  await new Promise((resolve, reject) => {
    const tx = rawDb.transaction(['assets', 'repairs'], 'readwrite');
    tx.objectStore('assets').clear();
    tx.objectStore('repairs').clear();
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
