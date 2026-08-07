#!/usr/bin/env node
// Compare two schema reports produced by scripts/schema-report.sql.
//
//   npm run schema:diff -- production.json e2e.json
//
// See CLAUDE.md, "Schema drift", for why this exists and what it can and
// cannot catch.

import fs from 'node:fs';
import path from 'node:path';
import { diffReports, formatFindings } from './schema-diff-lib.js';

// Differences that are deliberate, as "<section>:<id>". Empty, and that
// is the intended state: the two projects should be identical, so
// anything here needs a comment saying why it isn't a bug.
const IGNORE = [];

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error('Usage: npm run schema:diff -- <report-a.json> <report-b.json>');
  console.error('Produce each with scripts/schema-report.sql in that project.');
  process.exit(2);
}

const load = (file) => {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    console.error(`Could not read ${file}`);
    process.exit(2);
  }
  try {
    const parsed = JSON.parse(raw);
    // The SQL editor's CSV/JSON export sometimes wraps the cell in a row
    // object rather than giving the value on its own.
    return parsed.report ? JSON.parse(parsed.report) : parsed;
  } catch {
    console.error(`${file} is not valid JSON. Paste the whole cell from the SQL editor.`);
    process.exit(2);
  }
};

const nameA = path.basename(fileA, '.json');
const nameB = path.basename(fileB, '.json');
const findings = diffReports(load(fileA), load(fileB), { nameA, nameB, ignore: IGNORE });

console.log(`Comparing ${nameA} <-> ${nameB}\n`);
for (const line of formatFindings(findings)) console.log(`  ${line}`);

if (findings.length) {
  console.log(
    `\n${findings.length} difference(s). These are databases, not code - decide which one is ` +
      `right, then write a migration rather than editing schema.sql to match.`
  );
}
// Non-zero on drift, so this can gate something later if that's ever wanted.
process.exit(findings.length ? 1 : 0);
