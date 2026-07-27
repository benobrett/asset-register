import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  storageUpload,
  tableUpsert,
  getUnsyncedAssetsMock,
  markAssetSyncedMock,
  getUnsyncedRepairsMock,
  markRepairSyncedMock,
  getUnsyncedRepairCommentsMock,
  markRepairCommentSyncedMock,
} = vi.hoisted(() => ({
  storageUpload: vi.fn(),
  tableUpsert: vi.fn(),
  getUnsyncedAssetsMock: vi.fn(),
  markAssetSyncedMock: vi.fn(),
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
  getUnsyncedRepairs: getUnsyncedRepairsMock,
  markRepairSynced: markRepairSyncedMock,
  getUnsyncedRepairComments: getUnsyncedRepairCommentsMock,
  markRepairCommentSynced: markRepairCommentSyncedMock,
}));

const { syncQueuedAssets, syncQueuedRepairs, syncQueuedRepairComments, syncAll } = await import(
  '../src/sync.js'
);

beforeEach(() => {
  storageUpload.mockReset().mockResolvedValue({ error: null });
  tableUpsert.mockReset().mockResolvedValue({ error: null });
  getUnsyncedAssetsMock.mockReset().mockResolvedValue([]);
  markAssetSyncedMock.mockReset().mockResolvedValue(undefined);
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
    });
    expect(markAssetSyncedMock).toHaveBeenCalledWith('1');
    expect(result).toEqual({ succeeded: ['1'], failed: [] });
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
  it('syncs assets before repairs before repair comments', async () => {
    const order = [];
    getUnsyncedAssetsMock.mockImplementation(async () => {
      order.push('assets');
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

    expect(order).toEqual(['assets', 'repairs', 'repairComments']);
  });
});
