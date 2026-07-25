// Pure validation logic for the new-asset form — kept separate from
// capture.js so it can be unit tested without a DOM or Supabase client.
export function validateAssetForm({ description, recordedAt, repairNeeded, repairDescription }) {
  const errors = {};

  if (!description || !description.trim()) {
    errors.description = 'Description is required.';
  }

  if (!recordedAt) {
    errors.recordedAt = 'Date/time is required.';
  } else if (Number.isNaN(new Date(recordedAt).getTime())) {
    errors.recordedAt = 'Date/time is invalid.';
  }

  if (repairNeeded && (!repairDescription || !repairDescription.trim())) {
    errors.repairDescription = 'Describe the repair that is needed.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
