export function formatAssetId(assetNumber) {
  return `Item-${String(assetNumber).padStart(2, '0')}`;
}

// Best-to-worst order - also doubles as the sort rank (see conditionRank)
// and the single source of truth validation.js checks stored values
// against, so the two can never drift apart.
export const CONDITION_VALUES = ['good', 'ok', 'poor'];

const CONDITION_LABELS = {
  good: 'Good',
  ok: 'OK',
  poor: 'Poor',
};

// Stored lowercase, displayed capitalised - mixing display casing into the
// stored value would make the database check constraint fragile and
// invite case-mismatch bugs. Null/unknown values return null; callers
// decide their own "not set" placeholder.
export function formatCondition(condition) {
  return CONDITION_LABELS[condition] ?? null;
}

// Explicit rank, not alphabetical - Good/OK/Poor happens to already sort
// alphabetically, which would make a naive string sort look correct right
// up until a fourth value is added. Unset (null/undefined/unrecognised)
// ranks after every real value, so it sorts last rather than as best or
// worst.
export function conditionRank(condition) {
  const index = CONDITION_VALUES.indexOf(condition);
  return index === -1 ? CONDITION_VALUES.length : index;
}
