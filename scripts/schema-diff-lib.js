// The comparison half of the schema drift check, kept free of the
// filesystem and the CLI so it can be unit tested directly
// (tests/schema-diff.test.js). schema-diff.mjs wraps it.
//
// Same split, and the same reasoning, as the cleanup function's
// orphans.js: the decision logic is where the bugs would be, so it's the
// part that gets tests.

// Each section of the report, and how to identify one entry within it.
// Everything is compared as a keyed set rather than positionally - the
// SQL orders its arrays, but relying on that would make an unrelated
// rename look like a change.
const SECTIONS = [
  { key: 'foreign_keys', label: 'foreign key', id: (row) => `${row.table}.${row.name}` },
  { key: 'checks', label: 'check constraint', id: (row) => `${row.table}.${row.name}` },
  { key: 'rls', label: 'RLS', id: (row) => row.table },
  { key: 'policies', label: 'policy', id: (row) => `${row.table}.${row.name}` },
  { key: 'triggers', label: 'trigger', id: (row) => `${row.table}.${row.name}` },
  { key: 'columns', label: 'column', id: (row) => `${row.table}.${row.column}` },
  { key: 'storage_policies', label: 'storage policy', id: (row) => row.name },
  { key: 'buckets', label: 'bucket', id: (row) => row.name },
];

// Scalars that sit outside the arrays above.
const SCALARS = [{ key: 'storage_rls', label: 'RLS on storage.objects' }];

/**
 * Compare two schema reports.
 *
 * @param {object} a           Report from the first project.
 * @param {object} b           Report from the second.
 * @param {object} [options]
 * @param {string} [options.nameA] Label for the first, e.g. "production".
 * @param {string} [options.nameB] Label for the second.
 * @param {string[]} [options.ignore] Findings to accept, as
 *   "<section>:<id>" (e.g. "columns:assets.notes"). For differences that
 *   are deliberate - there are none today, and that is the point.
 * @returns {Array<{section, label, id, kind, a, b}>} findings, ordered.
 *   kind is 'missing-in-a' | 'missing-in-b' | 'different'.
 */
export function diffReports(a, b, { nameA = 'A', nameB = 'B', ignore = [] } = {}) {
  const ignored = new Set(ignore);
  const findings = [];

  for (const { key, label } of SCALARS) {
    if (ignored.has(`${key}:`)) continue;
    if (!same(a?.[key], b?.[key])) {
      findings.push({ section: key, label, id: '', kind: 'different', a: a?.[key], b: b?.[key] });
    }
  }

  for (const { key, label, id } of SECTIONS) {
    const rowsA = index(a?.[key], id);
    const rowsB = index(b?.[key], id);

    for (const [rowId, rowA] of rowsA) {
      if (ignored.has(`${key}:${rowId}`)) continue;
      if (!rowsB.has(rowId)) {
        findings.push({ section: key, label, id: rowId, kind: 'missing-in-b', a: rowA, b: null });
      } else if (!same(rowA, rowsB.get(rowId))) {
        findings.push({
          section: key,
          label,
          id: rowId,
          kind: 'different',
          a: rowA,
          b: rowsB.get(rowId),
        });
      }
    }

    for (const [rowId, rowB] of rowsB) {
      if (ignored.has(`${key}:${rowId}`)) continue;
      if (!rowsA.has(rowId)) {
        findings.push({ section: key, label, id: rowId, kind: 'missing-in-a', a: null, b: rowB });
      }
    }
  }

  return findings.map((finding) => ({ ...finding, nameA, nameB }));
}

/**
 * Human-readable lines. Names the object and both values, rather than
 * printing a raw diff someone then has to interpret - a report nobody
 * reads is the same as no report.
 */
export function formatFindings(findings) {
  if (!findings.length) return ['No schema drift found.'];

  return findings.map((f) => {
    const where = f.id ? `${f.label} ${f.id}` : f.label;
    if (f.kind === 'missing-in-b') return `${where}: present in ${f.nameA}, MISSING in ${f.nameB}`;
    if (f.kind === 'missing-in-a') return `${where}: MISSING in ${f.nameA}, present in ${f.nameB}`;
    return `${where}: differs\n    ${f.nameA}: ${brief(f.a)}\n    ${f.nameB}: ${brief(f.b)}`;
  });
}

function index(rows, id) {
  const map = new Map();
  for (const row of rows ?? []) {
    if (row) map.set(id(row), row);
  }
  return map;
}

// Key order out of jsonb_build_object is stable, but not worth trusting
// across Postgres versions - compare on sorted keys.
function same(x, y) {
  return canonical(x) === canonical(y);
}

function canonical(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(',')}}`;
}

function brief(value) {
  if (value === null || value === undefined) return '(absent)';
  if (typeof value !== 'object') return String(value);
  // Drop the identifying fields; they're already in the line above.
  const rest = { ...value };
  delete rest.table;
  delete rest.name;
  delete rest.column;
  return JSON.stringify(rest);
}
