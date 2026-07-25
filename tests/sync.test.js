import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storageUpload, tableUpsert, getUnsyncedAssetsMock, markAssetSyncedMock } = vi.hoisted(
  () => ({
    storageUpload: vi.fn(),
    tableUpsert: vi.fn(),
    getUnsyncedAssetsMock: vi.fn(),
    markAssetSyncedMock: vi.fn(),
  })
);

vi.mock('../src/supabase.js', () => ({
  supabase: {
    storage: { from: () => ({ upload: storageUpload }) },
    from: () => ({ upsert: tableUpsert }),
  },
  PHOTO_BUCKET: 'asset-photos',
}));

vi.mock('../src/db.js', () => ({
  getUnsyncedAssets: getUnsyncedAssetsMock,
  markAssetSynced: markAssetSyncedMock,
}));

const { syncQueuedAssets } = await import('../src/sync.js');

beforeEach(() => {
  storageUpload.mockReset().mockResolvedValue({ error: null });
  tableUpsert.mockReset().mockResolvedValue({ error: null });
  getUnsyncedAssetsMock.mockReset();
  markAssetSyncedMock.mockReset().mockResolvedValue(undefined);
});

describe('syncQueuedAssets', () => {
  it('uploads the photo and upserts the row, then marks it synced', async () => {
    getUnsyncedAssetsMock.mockResolvedValue([
      {
        id: '1',
        description: 'Office chair',
        recordedAt: '2026-07-25T10:00:00.000Z',
        photoPath: 'user-1/1.jpg',
        photo: new Blob(['x']),
        repairNeeded: false,
        repairDescription: null,
      },
    ]);

    const result = await syncQueuedAssets();

    expect(storageUpload).toHaveBeenCalledWith('user-1/1.jpg', expect.any(Blob), {
      upsert: true,
    });
    expect(tableUpsert).toHaveBeenCalledWith({
      id: '1',
      description: 'Office chair',
      recorded_at: '2026-07-25T10:00:00.000Z',
      photo_path: 'user-1/1.jpg',
      repair_needed: false,
      repair_description: null,
    });
    expect(markAssetSyncedMock).toHaveBeenCalledWith('1');
    expect(result).toEqual({ succeeded: ['1'], failed: [] });
  });

  it('skips the photo upload when the asset has no photo', async () => {
    getUnsyncedAssetsMock.mockResolvedValue([
      {
        id: '2',
        description: 'Standing desk',
        recordedAt: '2026-07-25T10:00:00.000Z',
        photoPath: null,
        photo: null,
        repairNeeded: false,
        repairDescription: null,
      },
    ]);

    await syncQueuedAssets();

    expect(storageUpload).not.toHaveBeenCalled();
    expect(markAssetSyncedMock).toHaveBeenCalledWith('2');
  });

  it('leaves a record queued and reports the failure when the insert fails', async () => {
    getUnsyncedAssetsMock.mockResolvedValue([
      {
        id: '3',
        description: 'Desk lamp',
        recordedAt: '2026-07-25T10:00:00.000Z',
        photoPath: null,
        photo: null,
        repairNeeded: false,
        repairDescription: null,
      },
    ]);
    tableUpsert.mockResolvedValue({ error: { message: 'network error' } });

    const result = await syncQueuedAssets();

    expect(markAssetSyncedMock).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: [], failed: [{ id: '3', error: 'network error' }] });
  });
});
