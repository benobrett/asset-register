import { describe, it, expect } from 'vitest';
import { readDraftFields, draftHasContent } from '../src/views/capture.js';

// The restore path is the one that has to survive the page being
// destroyed, and it is the one nobody will exercise by hand - you'd have
// to get Android to evict the page mid-capture to see it. So the decision
// logic is pulled out here where it can be tested directly.
//
// Issue #105: on Android, returning from the camera wiped the form.

describe('readDraftFields', () => {
  it('keeps the fields worth restoring', () => {
    const draft = readDraftFields({
      assetName: 'Fence post 14',
      description: 'Leaning after the storm',
      recordedAt: '2026-08-08T09:30',
      condition: 'poor',
      conditionNote: 'Rotten at the base',
    });

    expect(draft).toEqual({
      assetName: 'Fence post 14',
      description: 'Leaning after the storm',
      recordedAt: '2026-08-08T09:30',
      condition: 'poor',
      conditionNote: 'Rotten at the base',
    });
  });

  // Repair sub-forms come and go as they're opened and closed. Restoring
  // a stale value into one would be worse than losing it.
  it('ignores anything not on the list', () => {
    const draft = readDraftFields({ assetName: 'Gate', repairDescription: 'half typed' });
    expect(draft).toEqual({ assetName: 'Gate' });
  });

  it('drops empty strings rather than storing them', () => {
    expect(readDraftFields({ assetName: '', description: 'Only this' })).toEqual({
      description: 'Only this',
    });
  });

  it('survives being handed nothing', () => {
    expect(readDraftFields(undefined)).toEqual({});
    expect(readDraftFields({})).toEqual({});
  });

  it('ignores non-string values rather than persisting them', () => {
    expect(readDraftFields({ assetName: 42, description: null })).toEqual({});
  });
});

describe('draftHasContent', () => {
  // The form auto-fills recordedAt on open, so treating "has any key" as
  // content would make simply visiting the screen leave a draft behind -
  // and restore an empty form over an empty form forever.
  it('does not count an untouched form as content', () => {
    expect(draftHasContent({ recordedAt: '2026-08-08T09:30' })).toBe(false);
  });

  it('counts a typed field', () => {
    expect(draftHasContent({ recordedAt: '2026-08-08T09:30', assetName: 'Gate' })).toBe(true);
    expect(draftHasContent({ description: 'Something' })).toBe(true);
    expect(draftHasContent({ conditionNote: 'Rusty' })).toBe(true);
  });

  // The case the bug is actually about: a photo taken, the page destroyed
  // by the camera hand-off, and nothing typed yet.
  it('counts a photo on its own', () => {
    expect(draftHasContent({ photos: [{ localId: 'p1' }] })).toBe(true);
  });

  it('treats an empty photo list as no content', () => {
    expect(draftHasContent({ photos: [] })).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(draftHasContent(null)).toBe(false);
    expect(draftHasContent(undefined)).toBe(false);
    expect(draftHasContent({})).toBe(false);
  });
});
