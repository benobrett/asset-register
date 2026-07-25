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
