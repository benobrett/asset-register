import { describe, it, expect } from 'vitest';
import { diffReports, formatFindings } from '../scripts/schema-diff-lib.js';

// The two drifts this exists to catch are reproduced below as the first
// two cases, from the reports the live projects would actually have
// produced at the time. If a refactor breaks either, the tool has stopped
// doing the only job it was built for.

const empty = {
  foreign_keys: [],
  checks: [],
  rls: [],
  policies: [],
  triggers: [],
  columns: [],
  storage_policies: [],
  buckets: [],
  storage_rls: true,
};

describe('diffReports', () => {
  it('catches issue #99: a missing on-delete cascade', () => {
    const prod = {
      ...empty,
      foreign_keys: [
        { name: 'asset_repairs_asset_id_fkey', table: 'asset_repairs', references: 'assets', on_delete: 'a' },
      ],
    };
    const e2e = {
      ...empty,
      foreign_keys: [
        { name: 'asset_repairs_asset_id_fkey', table: 'asset_repairs', references: 'assets', on_delete: 'c' },
      ],
    };

    const findings = diffReports(prod, e2e, { nameA: 'production', nameB: 'e2e' });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      section: 'foreign_keys',
      id: 'asset_repairs.asset_repairs_asset_id_fkey',
      kind: 'different',
    });
    expect(formatFindings(findings)[0]).toContain('production');
  });

  it('catches issue #97: a Storage policy present in one project and not the other', () => {
    const prod = { ...empty, storage_policies: [] };
    const e2e = {
      ...empty,
      storage_policies: [{ name: 'Logged-in users can manage asset photos', command: 'ALL' }],
    };

    const findings = diffReports(prod, e2e, { nameA: 'production', nameB: 'e2e' });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('missing-in-a');
    expect(formatFindings(findings)[0]).toMatch(/MISSING in production/);
  });

  it('catches a bucket that has been made public in one project', () => {
    const findings = diffReports(
      { ...empty, buckets: [{ name: 'asset-photos', public: false }] },
      { ...empty, buckets: [{ name: 'asset-photos', public: true }] }
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ section: 'buckets', id: 'asset-photos', kind: 'different' });
  });

  it('catches RLS being switched off on storage.objects', () => {
    const findings = diffReports({ ...empty, storage_rls: true }, { ...empty, storage_rls: false });
    expect(findings).toHaveLength(1);
    expect(findings[0].section).toBe('storage_rls');
  });

  it('reports nothing when the two projects agree', () => {
    const report = {
      ...empty,
      foreign_keys: [{ name: 'fk', table: 't', references: 'u', on_delete: 'c' }],
      policies: [{ table: 't', name: 'p', command: 'ALL', using: 'true', with_check: 'true' }],
      buckets: [{ name: 'asset-photos', public: false }],
    };

    expect(diffReports(report, structuredClone(report))).toEqual([]);
    expect(formatFindings([])).toEqual(['No schema drift found.']);
  });

  // The SQL orders its arrays, but a tool that only works when both sides
  // happen to be sorted the same way would fail quietly and look clean.
  it('compares as a keyed set, not positionally', () => {
    const a = {
      ...empty,
      foreign_keys: [
        { name: 'one', table: 't', references: 'u', on_delete: 'c' },
        { name: 'two', table: 't', references: 'u', on_delete: 'c' },
      ],
    };
    const b = { ...empty, foreign_keys: [...a.foreign_keys].reverse() };

    expect(diffReports(a, b)).toEqual([]);
  });

  it('is insensitive to key order within a row', () => {
    const a = { ...empty, buckets: [{ name: 'b', public: false }] };
    const b = { ...empty, buckets: [{ public: false, name: 'b' }] };

    expect(diffReports(a, b)).toEqual([]);
  });

  it('reports both directions, so neither project is assumed correct', () => {
    const findings = diffReports(
      { ...empty, triggers: [{ name: 'only_in_a', table: 't', function: 'f' }] },
      { ...empty, triggers: [{ name: 'only_in_b', table: 't', function: 'f' }] }
    );

    expect(findings.map((f) => f.kind).sort()).toEqual(['missing-in-a', 'missing-in-b']);
  });

  it('accepts a documented deliberate difference via ignore', () => {
    const a = { ...empty, columns: [{ table: 't', column: 'c', type: 'text', nullable: 'YES' }] };
    const b = { ...empty, columns: [{ table: 't', column: 'c', type: 'text', nullable: 'NO' }] };

    expect(diffReports(a, b)).toHaveLength(1);
    expect(diffReports(a, b, { ignore: ['columns:t.c'] })).toEqual([]);
  });

  it('treats a missing section as empty rather than throwing', () => {
    expect(() => diffReports({}, {})).not.toThrow();
    expect(diffReports({}, {})).toEqual([]);
  });

  it('names the object and both values, not just that something changed', () => {
    const line = formatFindings(
      diffReports(
        { ...empty, foreign_keys: [{ name: 'fk', table: 'asset_repairs', references: 'assets', on_delete: 'a' }] },
        { ...empty, foreign_keys: [{ name: 'fk', table: 'asset_repairs', references: 'assets', on_delete: 'c' }] },
        { nameA: 'production', nameB: 'e2e' }
      )
    )[0];

    expect(line).toContain('asset_repairs.fk');
    expect(line).toContain('production');
    expect(line).toContain('e2e');
  });
});
