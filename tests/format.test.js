import { describe, expect, it } from 'vitest';
import { formatAssetId, formatCondition, conditionRank } from '../src/format.js';

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

describe('formatCondition', () => {
  it('capitalises the stored lowercase value', () => {
    expect(formatCondition('good')).toBe('Good');
    expect(formatCondition('ok')).toBe('OK');
    expect(formatCondition('poor')).toBe('Poor');
  });

  it('returns null for unset or unrecognised values', () => {
    expect(formatCondition(null)).toBeNull();
    expect(formatCondition(undefined)).toBeNull();
    expect(formatCondition('damaged')).toBeNull();
  });
});

describe('conditionRank', () => {
  it('ranks best to worst', () => {
    expect(conditionRank('good')).toBeLessThan(conditionRank('ok'));
    expect(conditionRank('ok')).toBeLessThan(conditionRank('poor'));
  });

  // Not alphabetical - Good/OK/Poor happens to already sort that way,
  // which would make a naive string sort look correct until a fourth
  // value broke the coincidence.
  it('ranks unset/unrecognised values after every real value', () => {
    expect(conditionRank(null)).toBeGreaterThan(conditionRank('poor'));
    expect(conditionRank(undefined)).toBeGreaterThan(conditionRank('poor'));
    expect(conditionRank('damaged')).toBeGreaterThan(conditionRank('poor'));
  });
});
