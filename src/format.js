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

// Array.from, not [0] - a name starting with an astral character (an
// emoji, some CJK extensions) is two UTF-16 code units, and indexing
// would slice it in half into an unrenderable lone surrogate.
function firstCharacter(value) {
  const trimmed = (value ?? '').trim();
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : '';
}

// Returns '' rather than a placeholder glyph when nothing can be derived -
// what to show instead is presentation, and belongs to the component, not
// to a formatting helper. Callers must handle the empty case.
export function formatInitials({ firstName, lastName } = {}) {
  return `${firstCharacter(firstName)}${firstCharacter(lastName)}`;
}

// Full name → whichever single name is on file → email. The profile
// completeness gate deliberately fails open (see auth.js), so an account
// with no name at all can reach the app - the email fallback is what
// stops that rendering as "undefined undefined" or an empty box. Same
// name-then-email chain repair comments already use for their authors.
export function formatDisplayName({ firstName, lastName, email } = {}) {
  const name = [firstName, lastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return name || (email ?? '').trim();
}
