import { describe, expect, it } from 'vitest';
import { validateAssetForm, validateRepairForm } from '../src/validation.js';

describe('validateAssetForm', () => {
  it('passes with an asset name, description, and date/time', () => {
    const result = validateAssetForm({
      assetName: 'Office chair 12',
      description: 'Office chair, blue',
      recordedAt: '2026-07-25T10:00',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('requires an asset name', () => {
    const result = validateAssetForm({
      assetName: '   ',
      description: 'Office chair, blue',
      recordedAt: '2026-07-25T10:00',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.assetName).toBeDefined();
  });

  it('requires a description', () => {
    const result = validateAssetForm({
      assetName: 'Office chair 12',
      description: '   ',
      recordedAt: '2026-07-25T10:00',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.description).toBeDefined();
  });

  it('requires a date/time', () => {
    const result = validateAssetForm({
      assetName: 'Office chair 12',
      description: 'Office chair',
      recordedAt: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.recordedAt).toBeDefined();
  });
});

describe('validateRepairForm', () => {
  it('passes with a repair description', () => {
    const result = validateRepairForm({ description: 'Armrest is cracked' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('requires a repair description', () => {
    const result = validateRepairForm({ description: '   ' });
    expect(result.valid).toBe(false);
    expect(result.errors.description).toBeDefined();
  });
});
