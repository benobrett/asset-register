import { describe, expect, it } from 'vitest';
import { validateAssetForm } from '../src/validation.js';

describe('validateAssetForm', () => {
  it('passes with an asset name, description, date/time, and no repair', () => {
    const result = validateAssetForm({
      assetName: 'Office chair 12',
      description: 'Office chair, blue',
      recordedAt: '2026-07-25T10:00',
      repairNeeded: false,
      repairDescription: '',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('requires an asset name', () => {
    const result = validateAssetForm({
      assetName: '   ',
      description: 'Office chair, blue',
      recordedAt: '2026-07-25T10:00',
      repairNeeded: false,
      repairDescription: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.assetName).toBeDefined();
  });

  it('requires a description', () => {
    const result = validateAssetForm({
      assetName: 'Office chair 12',
      description: '   ',
      recordedAt: '2026-07-25T10:00',
      repairNeeded: false,
      repairDescription: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.description).toBeDefined();
  });

  it('requires a date/time', () => {
    const result = validateAssetForm({
      assetName: 'Office chair 12',
      description: 'Office chair',
      recordedAt: '',
      repairNeeded: false,
      repairDescription: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.recordedAt).toBeDefined();
  });

  it('requires a repair description when repair is needed', () => {
    const result = validateAssetForm({
      assetName: 'Office chair 12',
      description: 'Office chair',
      recordedAt: '2026-07-25T10:00',
      repairNeeded: true,
      repairDescription: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.repairDescription).toBeDefined();
  });

  it('passes when repair is needed and a repair description is given', () => {
    const result = validateAssetForm({
      assetName: 'Office chair 12',
      description: 'Office chair',
      recordedAt: '2026-07-25T10:00',
      repairNeeded: true,
      repairDescription: 'Armrest is cracked',
    });
    expect(result.valid).toBe(true);
  });
});
