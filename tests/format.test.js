import { describe, expect, it } from 'vitest';
import {
  formatAssetId,
  formatCondition,
  conditionRank,
  formatInitials,
  formatDisplayName,
} from '../src/format.js';

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

describe('formatInitials', () => {
  it('takes the first letter of each name, uppercased', () => {
    expect(formatInitials({ firstName: 'Ben', lastName: 'Brett' })).toBe('BB');
    expect(formatInitials({ firstName: 'ada', lastName: 'lovelace' })).toBe('AL');
  });

  it('falls back to whichever single name is on file', () => {
    expect(formatInitials({ firstName: 'Ben', lastName: null })).toBe('B');
    expect(formatInitials({ firstName: null, lastName: 'Brett' })).toBe('B');
  });

  // The component renders a generic person icon on '' - deriving a letter
  // from an email would be a guess about someone who hasn't told us.
  it('returns an empty string when nothing can be derived', () => {
    expect(formatInitials({ firstName: null, lastName: null })).toBe('');
    expect(formatInitials({ firstName: '  ', lastName: '' })).toBe('');
    expect(formatInitials({})).toBe('');
    expect(formatInitials()).toBe('');
  });

  it('handles accented and non-Latin names', () => {
    expect(formatInitials({ firstName: 'Ngā', lastName: 'Mihi' })).toBe('NM');
    expect(formatInitials({ firstName: 'Émile', lastName: 'Zola' })).toBe('ÉZ');
  });

  // Array.from, not [0] - indexing a surrogate pair returns half a
  // character, which renders as a replacement glyph.
  it('does not split an astral character in half', () => {
    expect(formatInitials({ firstName: '𝒜lice', lastName: 'Smith' })).toBe('𝒜S');
  });
});

describe('formatDisplayName', () => {
  it('prefers the full name', () => {
    expect(
      formatDisplayName({ firstName: 'Ben', lastName: 'Brett', email: 'ben@example.com' })
    ).toBe('Ben Brett');
  });

  it('uses whichever single name is on file before falling back', () => {
    expect(formatDisplayName({ firstName: 'Ben', email: 'ben@example.com' })).toBe('Ben');
    expect(formatDisplayName({ lastName: 'Brett', email: 'ben@example.com' })).toBe('Brett');
  });

  // The completeness gate fails open, so an account with no name at all
  // genuinely reaches the app - this is what stops "undefined undefined".
  it('falls back to the email when no name is on file', () => {
    expect(formatDisplayName({ firstName: null, lastName: null, email: 'ben@example.com' })).toBe(
      'ben@example.com'
    );
    expect(formatDisplayName({ firstName: '   ', email: 'ben@example.com' })).toBe(
      'ben@example.com'
    );
  });

  it('returns an empty string when even the email is missing', () => {
    expect(formatDisplayName({})).toBe('');
    expect(formatDisplayName()).toBe('');
  });
});
