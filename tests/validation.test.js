import { describe, expect, it } from 'vitest';
import {
  validateAssetForm,
  validateRepairForm,
  validateNameForm,
  validatePassword,
  validatePasswordResetForm,
} from '../src/validation.js';

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

describe('validateNameForm', () => {
  it('passes with a plain first and last name', () => {
    const result = validateNameForm({ firstName: 'Jane', lastName: 'Smith' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("accepts hyphens, apostrophes, and accented/non-Latin characters", () => {
    const result = validateNameForm({ firstName: "O'Brien", lastName: 'Müller' });
    expect(result.valid).toBe(true);

    const result2 = validateNameForm({ firstName: 'Ngā', lastName: 'Mary-Anne' });
    expect(result2.valid).toBe(true);
  });

  it('requires a first name', () => {
    const result = validateNameForm({ firstName: '', lastName: 'Smith' });
    expect(result.valid).toBe(false);
    expect(result.errors.firstName).toBeDefined();
  });

  it('requires a last name', () => {
    const result = validateNameForm({ firstName: 'Jane', lastName: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.lastName).toBeDefined();
  });

  it('rejects whitespace-only names', () => {
    const result = validateNameForm({ firstName: '   ', lastName: '   ' });
    expect(result.valid).toBe(false);
    expect(result.errors.firstName).toBeDefined();
    expect(result.errors.lastName).toBeDefined();
  });

  it('rejects digits', () => {
    const result = validateNameForm({ firstName: 'Jane2', lastName: 'Smith' });
    expect(result.valid).toBe(false);
    expect(result.errors.firstName).toBeDefined();
  });

  it('rejects other special characters', () => {
    const result = validateNameForm({ firstName: 'Jane@', lastName: 'Smith!' });
    expect(result.valid).toBe(false);
    expect(result.errors.firstName).toBeDefined();
    expect(result.errors.lastName).toBeDefined();
  });

  it('rejects names over 50 characters', () => {
    const result = validateNameForm({ firstName: 'a'.repeat(51), lastName: 'Smith' });
    expect(result.valid).toBe(false);
    expect(result.errors.firstName).toBeDefined();
  });

  it('trims surrounding whitespace before checking length', () => {
    const result = validateNameForm({ firstName: '  Jane  ', lastName: '  Smith  ' });
    expect(result.valid).toBe(true);
  });
});

describe('validatePassword', () => {
  it('accepts a password of 6 or more characters', () => {
    expect(validatePassword('abc123')).toBeNull();
  });

  it('rejects a password under 6 characters', () => {
    expect(validatePassword('abc12')).toBeDefined();
  });

  it('rejects an empty password', () => {
    expect(validatePassword('')).toBeDefined();
  });
});

describe('validatePasswordResetForm', () => {
  it('passes when the password is valid and both fields match', () => {
    const result = validatePasswordResetForm({
      password: 'abc123',
      confirmPassword: 'abc123',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('rejects a password under 6 characters', () => {
    const result = validatePasswordResetForm({ password: 'abc', confirmPassword: 'abc' });
    expect(result.valid).toBe(false);
    expect(result.errors.password).toBeDefined();
  });

  it('rejects mismatched passwords', () => {
    const result = validatePasswordResetForm({
      password: 'abc123',
      confirmPassword: 'abc124',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.confirmPassword).toBeDefined();
  });

  it('reports only the password error when both are invalid', () => {
    const result = validatePasswordResetForm({ password: 'abc', confirmPassword: 'xyz' });
    expect(result.valid).toBe(false);
    expect(result.errors.password).toBeDefined();
    expect(result.errors.confirmPassword).toBeUndefined();
  });
});
