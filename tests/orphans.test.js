import { describe, it, expect } from 'vitest';
import {
  selectOrphans,
  selectMissingObjects,
  DEFAULT_GRACE_PERIOD_MS,
} from '../supabase/functions/cleanup-orphaned-photos/orphans.js';

// This is the decision half of a sweep that deletes files, so the cases
// worth covering are the ones where it must NOT act, not just the happy
// path. Everything the function needs is passed in, including the clock.
const NOW = Date.parse('2026-08-03T12:00:00.000Z');
const hoursAgo = (hours) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

describe('selectOrphans', () => {
  it('deletes an object nothing points at, once it is past the grace period', () => {
    const orphans = selectOrphans({
      objects: [{ path: 'user-1/gone.jpg', createdAt: hoursAgo(48) }],
      referencedPaths: [],
      now: NOW,
    });

    expect(orphans).toEqual(['user-1/gone.jpg']);
  });

  it('keeps an object that asset_photos still references', () => {
    const orphans = selectOrphans({
      objects: [
        { path: 'user-1/kept.jpg', createdAt: hoursAgo(500) },
        { path: 'user-1/gone.jpg', createdAt: hoursAgo(500) },
      ],
      referencedPaths: ['user-1/kept.jpg'],
      now: NOW,
    });

    expect(orphans).toEqual(['user-1/gone.jpg']);
  });

  // sync.js uploads the object first and inserts its asset_photos row
  // second, so a healthy photo has no row for a moment - and for however
  // long the device stays offline if that insert fails and the queue has to
  // retry. Sweeping inside that window deletes a photo someone just took.
  it('leaves a freshly uploaded object alone, row or no row', () => {
    const orphans = selectOrphans({
      objects: [{ path: 'user-1/just-uploaded.jpg', createdAt: hoursAgo(1) }],
      referencedPaths: [],
      now: NOW,
    });

    expect(orphans).toEqual([]);
  });

  it('treats the grace period boundary as old enough', () => {
    const objects = [{ path: 'user-1/edge.jpg', createdAt: new Date(NOW - DEFAULT_GRACE_PERIOD_MS) }];

    expect(selectOrphans({ objects, referencedPaths: [], now: NOW })).toEqual(['user-1/edge.jpg']);
    expect(selectOrphans({ objects, referencedPaths: [], now: NOW - 1 })).toEqual([]);
  });

  it('honours an overridden grace period', () => {
    const objects = [{ path: 'user-1/two-hours.jpg', createdAt: hoursAgo(2) }];

    expect(selectOrphans({ objects, referencedPaths: [], now: NOW })).toEqual([]);
    expect(
      selectOrphans({ objects, referencedPaths: [], now: NOW, gracePeriodMs: 60 * 60 * 1000 })
    ).toEqual(['user-1/two-hours.jpg']);
  });

  // No timestamp means no way to tell a long-dead orphan from a photo
  // uploaded a second ago. Keeping it costs a little storage; deleting it
  // could cost someone a trip back to the asset.
  it('keeps anything it cannot date', () => {
    const orphans = selectOrphans({
      objects: [
        { path: 'user-1/no-date.jpg', createdAt: null },
        { path: 'user-1/undated.jpg' },
        { path: 'user-1/nonsense.jpg', createdAt: 'not a date' },
      ],
      referencedPaths: [],
      now: NOW,
    });

    expect(orphans).toEqual([]);
  });

  it('ignores a malformed entry rather than throwing mid-sweep', () => {
    const orphans = selectOrphans({
      objects: [null, {}, { path: '', createdAt: hoursAgo(500) }],
      referencedPaths: [],
      now: NOW,
    });

    expect(orphans).toEqual([]);
  });

  it('returns oldest first, so a truncated run clears the stalest files', () => {
    const orphans = selectOrphans({
      objects: [
        { path: 'user-1/newer.jpg', createdAt: hoursAgo(30) },
        { path: 'user-2/oldest.jpg', createdAt: hoursAgo(900) },
        { path: 'user-1/middle.jpg', createdAt: hoursAgo(100) },
      ],
      referencedPaths: [],
      now: NOW,
    });

    expect(orphans).toEqual(['user-2/oldest.jpg', 'user-1/middle.jpg', 'user-1/newer.jpg']);
  });

  it('accepts a Set of referenced paths as readily as an array', () => {
    const orphans = selectOrphans({
      objects: [{ path: 'user-1/kept.jpg', createdAt: hoursAgo(500) }],
      referencedPaths: new Set(['user-1/kept.jpg']),
      now: NOW,
    });

    expect(orphans).toEqual([]);
  });

  it('does nothing with an empty bucket', () => {
    expect(selectOrphans({ objects: [], referencedPaths: [], now: NOW })).toEqual([]);
  });
});

// The mirror image, and the one that's actually visible to a user: a
// signed URL is issued for a path that doesn't exist, so detail.js can't
// filter it out and it renders as a broken image.
describe('selectMissingObjects', () => {
  it('reports a row whose file is not in the bucket', () => {
    const missing = selectMissingObjects({
      objects: [{ path: 'user-1/here.jpg' }],
      referencedPaths: ['user-1/here.jpg', 'user-1/vanished.jpg'],
    });

    expect(missing).toEqual(['user-1/vanished.jpg']);
  });

  it('says nothing when every row has its file', () => {
    const missing = selectMissingObjects({
      objects: [{ path: 'user-1/a.jpg' }, { path: 'user-1/b.jpg' }],
      referencedPaths: ['user-1/a.jpg', 'user-1/b.jpg'],
    });

    expect(missing).toEqual([]);
  });

  // No grace period, unlike selectOrphans: sync.js uploads the object
  // before inserting the row, so a healthy photo never passes through a
  // row-without-file state. Any instance is worth reporting at once.
  it('applies no grace period - a brand new row with no file still reports', () => {
    const missing = selectMissingObjects({
      objects: [],
      referencedPaths: ['user-1/just-inserted.jpg'],
    });

    expect(missing).toEqual(['user-1/just-inserted.jpg']);
  });

  it('reports a path referenced by two rows only once', () => {
    const missing = selectMissingObjects({
      objects: [],
      referencedPaths: ['user-1/shared.jpg', 'user-1/shared.jpg'],
    });

    expect(missing).toEqual(['user-1/shared.jpg']);
  });

  it('ignores malformed entries on either side', () => {
    const missing = selectMissingObjects({
      objects: [null, {}, { path: 'user-1/ok.jpg' }],
      referencedPaths: ['user-1/ok.jpg', '', null, 'user-1/gone.jpg'],
    });

    expect(missing).toEqual(['user-1/gone.jpg']);
  });

  it('reports nothing when there are no rows at all', () => {
    expect(
      selectMissingObjects({ objects: [{ path: 'user-1/a.jpg' }], referencedPaths: [] })
    ).toEqual([]);
  });
});
