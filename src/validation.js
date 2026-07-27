// Pure validation logic for the asset and repair forms — kept separate from
// the views so it can be unit tested without a DOM or Supabase client.
export function validateAssetForm({ assetName, description, recordedAt }) {
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
