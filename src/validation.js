import { CONDITION_VALUES } from './format.js';

// A serial plate, the damage, and the asset in situ are three different
// photographs of the same thing - four leaves room without turning the
// capture form into a gallery.
//
// Client-side only, deliberately: the shared "any logged-in user can edit
// everything" policy means two people adding photos to the same asset at
// once can both pass this and produce a fifth row. That's the same class
// of problem as the last-write-wins limitation already documented for
// offline edits, and the reading side tolerates it - see CLAUDE.md.
export const MAX_ASSET_PHOTOS = 4;

// Takes a count rather than a list so the capture screen (queued photos
// only) and the detail screen (saved photos plus queued additions) can
// share one implementation instead of each doing its own arithmetic.
export function photoLimitReached(currentCount) {
  return (currentCount ?? 0) >= MAX_ASSET_PHOTOS;
}

// Matches the check constraint on assets.condition_note in schema.sql -
// suggested by design as long enough for a real note ("rust on the left
// hinge, still closes fine") but short enough to stay a note, not a
// second description field.
export const CONDITION_NOTE_MAX_LENGTH = 200;

// Pure validation logic for the asset and repair forms — kept separate from
// the views so it can be unit tested without a DOM or Supabase client.
//
// condition/conditionNote are folded into this shared validator rather
// than a separate function: both capture.js and detail.js already
// validate the rest of the asset fields through validateAssetForm, so one
// combined validator per form stays consistent with the rest of this file.
// Both are optional - field staff logging assets quickly (sometimes
// offline) shouldn't be blocked by one more required field, and a forced
// choice would produce guessed data. A blank/unset value is never an
// error; only an invalid one is.
export function validateAssetForm({ assetName, description, recordedAt, condition, conditionNote }) {
  const errors = {};

  if (!assetName || !assetName.trim()) {
    errors.assetName = 'Asset name is required.';
  }

  if (!description || !description.trim()) {
    errors.description = 'Description is required.';
  }

  if (!recordedAt) {
    errors.recordedAt = 'Date/time is required.';
  } else if (Number.isNaN(new Date(recordedAt).getTime())) {
    errors.recordedAt = 'Date/time is invalid.';
  }

  if (condition && !CONDITION_VALUES.includes(condition)) {
    errors.condition = 'Condition must be Good, OK, or Poor.';
  }

  if (conditionNote && conditionNote.trim().length > CONDITION_NOTE_MAX_LENGTH) {
    errors.conditionNote = `Condition note must be ${CONDITION_NOTE_MAX_LENGTH} characters or fewer.`;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateRepairForm({ description }) {
  const errors = {};

  if (!description || !description.trim()) {
    errors.description = 'Repair description is required.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// Unicode-aware (\p{L}) so accented/non-Latin letters pass (e.g. "Ngā",
// "Müller"), alongside spaces, hyphens, and apostrophes (e.g. "O'Brien").
// Digits and other punctuation are rejected. Shared by the signup form
// and the post-login name-completion prompt — one validator, not two.
const NAME_PATTERN = /^[\p{L}\s'-]+$/u;

function validateNameField(value, label) {
  const trimmed = (value || '').trim();

  if (!trimmed) {
    return `${label} is required.`;
  }
  if (trimmed.length > 50) {
    return `${label} must be 50 characters or fewer.`;
  }
  if (!NAME_PATTERN.test(trimmed)) {
    return `${label} can only contain letters, spaces, hyphens, and apostrophes.`;
  }
  return null;
}

export function validateNameForm({ firstName, lastName }) {
  const errors = {};

  const firstNameError = validateNameField(firstName, 'First name');
  if (firstNameError) errors.firstName = firstNameError;

  const lastNameError = validateNameField(lastName, 'Last name');
  if (lastNameError) errors.lastName = lastNameError;

  return { valid: Object.keys(errors).length === 0, errors };
}

// Matches Supabase Auth's own default minimum - shared by signup and the
// password-reset screen so the reset screen can never accept a password
// signup would have rejected.
export function validatePassword(password) {
  if (!password || password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}

export function validatePasswordResetForm({ password, confirmPassword }) {
  const errors = {};

  const passwordError = validatePassword(password);
  if (passwordError) {
    errors.password = passwordError;
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
