import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  storageUpload,
  tableUpsert,
  getUnsyncedAssetsMock,
  markAssetSyncedMock,
  getUnsyncedPhotosMock,
  markPhotoSyncedMock,
  getUnsyncedRepairsMock,
  markRepairSyncedMock,
  getUnsyncedRepairCommentsMock,
  markRepairCommentSyncedMock,
} = vi.hoisted(() => ({
  storageUpload: vi.fn(),
  tableUpsert: vi.fn(),
  getUnsyncedAssetsMock: vi.fn(),
  markAssetSyncedMock: vi.fn(),
  getUnsyncedPhotosMock: vi.fn(),
  markPhotoSyncedMock: vi.fn(),
  getUnsyncedRepairsMock: vi.fn(),
  markRepairSyncedMock: vi.fn(),
  getUnsyncedRepairCommentsMock: vi.fn(),
  markRepairCommentSyncedMock: vi.fn(),
}));

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
  getUnsyncedPhotos: getUnsyncedPhotosMock,
  markPhotoSynced: markPhotoSyncedMock,
  getUnsyncedRepairs: getUnsyncedRepairsMock,
  markRepairSynced: markRepairSyncedMock,
  getUnsyncedRepairComments: getUnsyncedRepairCommentsMock,
  markRepairCommentSynced: markRepairCommentSyncedMock,
}));

const {
  syncQueuedAssets,
  syncQueuedPhotos,
  syncQueuedRepairs,
  syncQueuedRepairComments,
  syncAll,
} = await import(
  '../src/sync.js'
);

beforeEach(() => {
  storageUpload.mockReset().mockResolvedValue({ error: null });
  tableUpsert.mockReset().mockResolvedValue({ error: null });
  getUnsyncedAssetsMock.mockReset().mockResolvedValue([]);
  markAssetSyncedMock.mockReset().mockResolvedValue(undefined);
  getUnsyncedPhotosMock.mockReset().mockResolvedValue([]);
  markPhotoSyncedMock.mockReset().mockResolvedValue(undefined);
  getUnsyncedRepairsMock.mockReset().mockResolvedValue([]);
  markRepairSyncedMock.mockReset().mockResolvedValue(undefined);
  getUnsyncedRepairCommentsMock.mockReset().mockResolvedValue([]);
  markRepairCommentSyncedMock.mockReset().mockResolvedValue(undefined);
});

describe('syncQueuedAssets', () => {
  it('uploads the photo and upserts the row, then marks it synced', async () => {
    getUnsyncedAssetsMock.mockResolvedValue([
      {
        id: '1',
        assetName: 'Office chair 12',
        description: 'Office chair',
        recordedAt: '2026-07-25T10:00:00.000Z',
        photoPath: 'user-1/1.jpg',
        photo: new Blob(['x']),
      },
    ]);

    const result = await syncQueuedAssets();

    expect(storageUpload).toHaveBeenCalledWith('user-1/1.jpg', expect.any(Blob), {
      upsert: true,
    });
    expect(tableUpsert).toHaveBeenCalledWith({
      id: '1',
      asset_name: 'Office chair 12',
      description: 'Office chair',
      recorded_at: '2026-07-25T10:00:00.000Z',
      photo_path: 'user-1/1.jpg',
      condition: null,
      condition_note: null,
    });
    expect(markAssetSyncedMock).toHaveBeenCalledWith('1');
    expect(result).toEqual({ succeeded: ['1'], failed: [] });
  });

  it('includes condition and condition_note when set', async () => {
    getUnsyncedAssetsMock.mockResolvedValue([
      {
        id: '4',
        assetName: 'Wheelbarrow',
        description: 'Garden wheelbarrow',
        recordedAt: '2026-07-25T10:00:00.000Z',
        photoPath: null,
        photo: null,
        condition: 'poor',
        conditionNote: 'Squeaky wheel, still usable.',
      },
    ]);

    await syncQueuedAssets();

    expect(tableUpsert).toHaveBeenCalledWith({
      id: '4',
      asset_name: 'Wheelbarrow',
      description: 'Garden wheelbarrow',
      recorded_at: '2026-07-25T10:00:00.000Z',
      photo_path: null,
      condition: 'poor',
      condition_note: 'Squeaky wheel, still usable.',
    });
  });

  // A record queued before condition/conditionNote existed - the app
  // shell is service-worker cached, so a device can plausibly still have
  // one of these sitting in its queue when the new code loads. It must
  // sync as "unset", not throw or write undefined into the insert.
  it('syncs an old-shape queued asset with no condition fields at all', async () => {
    getUnsyncedAssetsMock.mockResolvedValue([
      {
        id: '5',
        assetName: 'Ladder',
        description: 'Aluminium ladder',
        recordedAt: '2026-07-25T10:00:00.000Z',
        photoPath: null,
        photo: null,
      },
    ]);

    const result = await syncQueuedAssets();

    expect(tableUpsert).toHaveBeenCalledWith({
      id: '5',
      asset_name: 'Ladder',
      description: 'Aluminium ladder',
      recorded_at: '2026-07-25T10:00:00.000Z',
      photo_path: null,
      condition: null,
      condition_note: null,
    });
    expect(markAssetSyncedMock).toHaveBeenCalledWith('5');
    expect(result).toEqual({ succeeded: ['5'], failed: [] });
  });

  // The shape assets were queued in before multiple photos shipped: one
  // blob attached to the asset itself, no separate photo records. The
  // app shell is service-worker cached, so a device can still be holding
  // one of these well after the deploy. It has to upload *and* end up
  // with an asset_photos row, or the photo reaches Storage with nothing
  // pointing at it and silently disappears from the app.
  it('syncs a legacy single-photo asset and gives it a photo row', async () => {
    getUnsyncedAssetsMock.mockResolvedValue([
      {
        id: 'legacy-1',
        assetName: 'Wheelbarrow',
        description: 'Garden wheelbarrow',
        recordedAt: '2026-07-25T10:00:00.000Z',
        photoPath: 'user-1/legacy.jpg',
        photo: new Blob(['old']),
      },
    ]);

    const result = await syncQueuedAssets();

    expect(storageUpload).toHaveBeenCalledWith('user-1/legacy.jpg', expect.any(Blob), {
      upsert: true,
    });
    expect(tableUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'legacy-1', photo_path: 'user-1/legacy.jpg' })
    );
    expect(tableUpsert).toHaveBeenCalledWith({
      asset_id: 'legacy-1',
      storage_path: 'user-1/legacy.jpg',
      position: 1,
    });
    expect(markAssetSyncedMock).toHaveBeenCalledWith('legacy-1');
    expect(result).toEqual({ succeeded: ['legacy-1'], failed: [] });
  });

  it('skips the photo upload when the asset has no photo', async () => {
    getUnsyncedAssetsMock.mockResolvedValue([
      {
        id: '2',
        assetName: 'Standing desk 4',
        description: 'Standing desk',
        recordedAt: '2026-07-25T10:00:00.000Z',
        photoPath: null,
        photo: null,
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
        assetName: 'Desk lamp 7',
        description: 'Desk lamp',
        recordedAt: '2026-07-25T10:00:00.000Z',
        photoPath: null,
        photo: null,
      },
    ]);
    tableUpsert.mockResolvedValue({ error: { message: 'network error' } });

    const result = await syncQueuedAssets();

    expect(markAssetSyncedMock).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: [], failed: [{ id: '3', error: 'network error' }] });
  });
});

describe('syncQueuedPhotos', () => {
  it('uploads each blob and inserts its row, preserving position', async () => {
    getUnsyncedPhotosMock.mockResolvedValue([
      {
        id: 'p1',
        assetId: 'a1',
        storagePath: 'user-1/p1.jpg',
        position: 1,
        blob: new Blob(['x']),
      },
      {
        id: 'p2',
        assetId: 'a1',
        storagePath: 'user-1/p2.jpg',
        position: 2,
        blob: new Blob(['y']),
      },
    ]);

    const result = await syncQueuedPhotos();

    expect(storageUpload).toHaveBeenCalledWith('user-1/p1.jpg', expect.any(Blob), { upsert: true });
    expect(storageUpload).toHaveBeenCalledWith('user-1/p2.jpg', expect.any(Blob), { upsert: true });
    expect(tableUpsert).toHaveBeenCalledWith({
      id: 'p1',
      asset_id: 'a1',
      storage_path: 'user-1/p1.jpg',
      position: 1,
    });
    expect(tableUpsert).toHaveBeenCalledWith({
      id: 'p2',
      asset_id: 'a1',
      storage_path: 'user-1/p2.jpg',
      position: 2,
    });
    expect(result).toEqual({ succeeded: ['p1', 'p2'], failed: [] });
  });

  // Positions are a sort key, not a count - removing a photo leaves a
  // gap rather than renumbering rows that didn't change.
  it('keeps non-contiguous positions exactly as queued', async () => {
    getUnsyncedPhotosMock.mockResolvedValue([
      { id: 'p3', assetId: 'a1', storagePath: 'user-1/p3.jpg', position: 4, blob: new Blob(['z']) },
    ]);

    await syncQueuedPhotos();

    expect(tableUpsert).toHaveBeenCalledWith({
      id: 'p3',
      asset_id: 'a1',
      storage_path: 'user-1/p3.jpg',
      position: 4,
    });
  });

  it('leaves a photo queued and reports the failure when the upload fails', async () => {
    getUnsyncedPhotosMock.mockResolvedValue([
      { id: 'p4', assetId: 'a1', storagePath: 'user-1/p4.jpg', position: 1, blob: new Blob(['q']) },
    ]);
    storageUpload.mockResolvedValue({ error: { message: 'network error' } });

    const result = await syncQueuedPhotos();

    expect(markPhotoSyncedMock).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: [], failed: [{ id: 'p4', error: 'network error' }] });
  });
});

describe('syncQueuedRepairs', () => {
  it('upserts the repair row and marks it synced', async () => {
    getUnsyncedRepairsMock.mockResolvedValue([
      {
        id: 'r1',
        assetId: '1',
        description: 'Armrest is cracked',
        reportedAt: '2026-07-25T10:00:00.000Z',
        completedAt: null,
        createdByEmail: 'jane@example.com',
      },
    ]);

    const result = await syncQueuedRepairs();

    expect(tableUpsert).toHaveBeenCalledWith({
      id: 'r1',
      asset_id: '1',
      description: 'Armrest is cracked',
      reported_at: '2026-07-25T10:00:00.000Z',
      completed_at: null,
      created_by_email: 'jane@example.com',
      updated_at: null,
      updated_by_email: null,
      completed_by_email: null,
    });
    expect(markRepairSyncedMock).toHaveBeenCalledWith('r1');
    expect(result).toEqual({ succeeded: ['r1'], failed: [] });
  });

  it('includes edited-at/by fields when the repair has been edited', async () => {
    getUnsyncedRepairsMock.mockResolvedValue([
      {
        id: 'r3',
        assetId: '1',
        description: 'Armrest is cracked (updated)',
        reportedAt: '2026-07-25T10:00:00.000Z',
        completedAt: null,
        createdByEmail: 'jane@example.com',
        updatedAt: '2026-07-25T11:00:00.000Z',
        updatedByEmail: 'sam@example.com',
      },
    ]);

    await syncQueuedRepairs();

    expect(tableUpsert).toHaveBeenCalledWith({
      id: 'r3',
      asset_id: '1',
      description: 'Armrest is cracked (updated)',
      reported_at: '2026-07-25T10:00:00.000Z',
      completed_at: null,
      created_by_email: 'jane@example.com',
      updated_at: '2026-07-25T11:00:00.000Z',
      updated_by_email: 'sam@example.com',
      completed_by_email: null,
    });
  });

  it('includes the completed-by field when the repair has been completed', async () => {
    getUnsyncedRepairsMock.mockResolvedValue([
      {
        id: 'r4',
        assetId: '1',
        description: 'Armrest is cracked',
        reportedAt: '2026-07-25T10:00:00.000Z',
        completedAt: '2026-07-25T12:00:00.000Z',
        createdByEmail: 'jane@example.com',
        completedByEmail: 'sam@example.com',
      },
    ]);

    await syncQueuedRepairs();

    expect(tableUpsert).toHaveBeenCalledWith({
      id: 'r4',
      asset_id: '1',
      description: 'Armrest is cracked',
      reported_at: '2026-07-25T10:00:00.000Z',
      completed_at: '2026-07-25T12:00:00.000Z',
      created_by_email: 'jane@example.com',
      updated_at: null,
      updated_by_email: null,
      completed_by_email: 'sam@example.com',
    });
  });

  it('leaves a repair queued and reports the failure when the upsert fails', async () => {
    getUnsyncedRepairsMock.mockResolvedValue([
      {
        id: 'r2',
        assetId: '1',
        description: 'Wheel is loose',
        reportedAt: '2026-07-25T10:00:00.000Z',
        completedAt: null,
        createdByEmail: 'jane@example.com',
      },
    ]);
    tableUpsert.mockResolvedValue({ error: { message: 'network error' } });

    const result = await syncQueuedRepairs();

    expect(markRepairSyncedMock).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: [], failed: [{ id: 'r2', error: 'network error' }] });
  });
});

describe('syncQueuedRepairComments', () => {
  it('upserts the comment row and marks it synced', async () => {
    getUnsyncedRepairCommentsMock.mockResolvedValue([
      {
        id: 'c1',
        repairId: 'r1',
        comment: 'Replaced the armrest bolt.',
        createdByEmail: 'sam@example.com',
        createdByName: 'Sam Smith',
      },
    ]);

    const result = await syncQueuedRepairComments();

    expect(tableUpsert).toHaveBeenCalledWith({
      id: 'c1',
      repair_id: 'r1',
      comment: 'Replaced the armrest bolt.',
      created_by_email: 'sam@example.com',
      created_by_name: 'Sam Smith',
    });
    expect(markRepairCommentSyncedMock).toHaveBeenCalledWith('c1');
    expect(result).toEqual({ succeeded: ['c1'], failed: [] });
  });

  it('defaults created_by_name to null when the account has no name on file', async () => {
    getUnsyncedRepairCommentsMock.mockResolvedValue([
      {
        id: 'c3',
        repairId: 'r1',
        comment: 'Ordered a replacement part.',
        createdByEmail: 'sam@example.com',
      },
    ]);

    await syncQueuedRepairComments();

    expect(tableUpsert).toHaveBeenCalledWith({
      id: 'c3',
      repair_id: 'r1',
      comment: 'Ordered a replacement part.',
      created_by_email: 'sam@example.com',
      created_by_name: null,
    });
  });

  it('leaves a comment queued and reports the failure when the upsert fails', async () => {
    getUnsyncedRepairCommentsMock.mockResolvedValue([
      {
        id: 'c2',
        repairId: 'r1',
        comment: 'Ordered a replacement part.',
        createdByEmail: 'sam@example.com',
      },
    ]);
    tableUpsert.mockResolvedValue({ error: { message: 'network error' } });

    const result = await syncQueuedRepairComments();

    expect(markRepairCommentSyncedMock).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: [], failed: [{ id: 'c2', error: 'network error' }] });
  });
});

describe('syncAll', () => {
  // Photos and repairs both reference an asset, and a comment references
  // a repair, so anything running before the row it points at would fail
  // its foreign key.
  it('syncs assets before photos before repairs before repair comments', async () => {
    const order = [];
    getUnsyncedAssetsMock.mockImplementation(async () => {
      order.push('assets');
      return [];
    });
    getUnsyncedPhotosMock.mockImplementation(async () => {
      order.push('photos');
      return [];
    });
    getUnsyncedRepairsMock.mockImplementation(async () => {
      order.push('repairs');
      return [];
    });
    getUnsyncedRepairCommentsMock.mockImplementation(async () => {
      order.push('repairComments');
      return [];
    });

    await syncAll();

    expect(order).toEqual(['assets', 'photos', 'repairs', 'repairComments']);
  });
});
