import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, selectMock, eqMock, maybeSingleMock, insertMock, updateMock, updateEqMock, updateSelectMock } =
  vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    selectMock: vi.fn(),
    eqMock: vi.fn(),
    maybeSingleMock: vi.fn(),
    insertMock: vi.fn(),
    updateMock: vi.fn(),
    updateEqMock: vi.fn(),
    updateSelectMock: vi.fn(),
  }));

vi.mock('../src/supabase.js', () => ({
  supabase: {
    auth: { getSession: getSessionMock },
    from: () => ({
      select: (...args) => {
        selectMock(...args);
        return { eq: (...eqArgs) => (eqMock(...eqArgs), { maybeSingle: maybeSingleMock }) };
      },
      insert: insertMock,
      update: (...args) => {
        updateMock(...args);
        return { eq: (...eqArgs) => (updateEqMock(...eqArgs), { select: updateSelectMock }) };
      },
    }),
  },
}));

const {
  getProfile,
  needsNamePrompt,
  submitProfileName,
  isProfileComplete,
  markProfileComplete,
  resetProfileCache,
} = await import('../src/auth.js');

const SESSION = { user: { id: 'user-1', email: 'jane@example.com' } };

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ data: { session: SESSION } });
  selectMock.mockReset();
  eqMock.mockReset();
  maybeSingleMock.mockReset().mockResolvedValue({ data: null, error: null });
  insertMock.mockReset().mockResolvedValue({ error: null });
  updateMock.mockReset();
  updateEqMock.mockReset();
  updateSelectMock.mockReset().mockResolvedValue({ data: [], error: null });
  resetProfileCache();
});

describe('getProfile', () => {
  it('returns null when there is no session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    expect(await getProfile()).toBeNull();
  });

  it('fetches the current user profile row', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { first_name: 'Jane', last_name: 'Smith' },
      error: null,
    });

    const profile = await getProfile();
    expect(eqMock).toHaveBeenCalledWith('id', 'user-1');
    expect(profile).toEqual({ first_name: 'Jane', last_name: 'Smith' });
  });
});

describe('needsNamePrompt', () => {
  it('is true when there is no profile row at all', () => {
    expect(needsNamePrompt(null)).toBe(true);
  });

  it('is true when either name is null', () => {
    expect(needsNamePrompt({ first_name: null, last_name: 'Smith' })).toBe(true);
    expect(needsNamePrompt({ first_name: 'Jane', last_name: null })).toBe(true);
  });

  it('is false once both names are set', () => {
    expect(needsNamePrompt({ first_name: 'Jane', last_name: 'Smith' })).toBe(false);
  });
});

describe('submitProfileName', () => {
  it('inserts a new row when none exists yet', async () => {
    await submitProfileName('Jane', 'Smith');

    expect(insertMock).toHaveBeenCalledWith({
      id: 'user-1',
      first_name: 'Jane',
      last_name: 'Smith',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('falls back to updating when a row already exists (unique_violation)', async () => {
    insertMock.mockResolvedValue({ error: { code: '23505' } });
    updateSelectMock.mockResolvedValue({ data: [{ id: 'user-1' }], error: null });

    await submitProfileName('Jane', 'Smith');

    expect(updateMock).toHaveBeenCalledWith({ first_name: 'Jane', last_name: 'Smith' });
    expect(updateEqMock).toHaveBeenCalledWith('id', 'user-1');
  });

  it('rejects when the account already has a name on file', async () => {
    insertMock.mockResolvedValue({ error: { code: '23505' } });
    // Zero rows back means RLS's null-names guard filtered the row out.
    updateSelectMock.mockResolvedValue({ data: [], error: null });

    await expect(submitProfileName('Jane', 'Smith')).rejects.toThrow(
      'This account already has a name on file.'
    );
  });

  it('throws on an unrelated insert failure', async () => {
    insertMock.mockResolvedValue({ error: { code: '500', message: 'network error' } });

    await expect(submitProfileName('Jane', 'Smith')).rejects.toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('isProfileComplete / markProfileComplete / resetProfileCache', () => {
  it('fails open (does not block) when the profile query errors', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'network error' } });
    expect(await isProfileComplete()).toBe(true);
  });

  it('queries once and caches the result across calls', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { first_name: 'Jane', last_name: 'Smith' },
      error: null,
    });

    expect(await isProfileComplete()).toBe(true);
    expect(await isProfileComplete()).toBe(true);
    expect(maybeSingleMock).toHaveBeenCalledTimes(1);
  });

  it('markProfileComplete short-circuits without another query', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    expect(await isProfileComplete()).toBe(false);

    markProfileComplete();
    expect(await isProfileComplete()).toBe(true);
    expect(maybeSingleMock).toHaveBeenCalledTimes(1);
  });

  it('resetProfileCache forces a fresh query', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    expect(await isProfileComplete()).toBe(false);

    resetProfileCache();
    maybeSingleMock.mockResolvedValue({
      data: { first_name: 'Jane', last_name: 'Smith' },
      error: null,
    });
    expect(await isProfileComplete()).toBe(true);
    expect(maybeSingleMock).toHaveBeenCalledTimes(2);
  });
});
