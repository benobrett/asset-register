import { describe, expect, it } from 'vitest';
import { formatAssetId } from '../src/format.js';

describe('formatAssetId', () => {
  it('zero-pads to two digits', () => {
    expect(formatAssetId(1)).toBe('Item-01');
    expect(formatAssetId(9)).toBe('Item-09');
    expect(formatAssetId(42)).toBe('Item-42');
  });

  it('does not truncate or re-pad numbers past 99', () => {
    expect(formatAssetId(100)).toBe('Item-100');
    expect(formatAssetId(101)).toBe('Item-101');
  });
});
