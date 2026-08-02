// The decision half of the cleanup sweep, kept free of Deno, Supabase and
// the network so it can be unit tested directly (tests/orphans.test.js).
// index.ts does the listing, querying and deleting around it.
//
// Plain .js rather than .ts so one file serves both: Deno imports it as-is,
// and Vitest and ESLint read it without a TypeScript toolchain this project
// otherwise has no use for.

// An object is only a candidate once it's older than this. sync.js uploads
// a photo to Storage *first* and inserts its asset_photos row second - the
// other order would briefly leave a row pointing at a file that isn't there
// - so there is always a window where a perfectly healthy photo has an
// object and no row. A failed insert widens that window to however long the
// device stays offline before the queue retries. A day is far longer than
// either needs and costs nothing, since the whole point of this sweep is
// that orphans are harmless until the storage bill notices them.
export const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * Which stored objects have nothing pointing at them any more.
 *
 * @param {object} args
 * @param {Array<{path: string, createdAt: string|Date|null}>} args.objects
 *   Everything currently in the bucket.
 * @param {Iterable<string>} args.referencedPaths
 *   Every asset_photos.storage_path.
 * @param {number|Date} args.now
 * @param {number} [args.gracePeriodMs]
 * @returns {string[]} paths safe to delete, oldest first.
 */
export function selectOrphans({
  objects,
  referencedPaths,
  now,
  gracePeriodMs = DEFAULT_GRACE_PERIOD_MS,
}) {
  const referenced = new Set(referencedPaths);
  const nowMs = now instanceof Date ? now.getTime() : now;

  return objects
    .filter((object) => {
      if (!object?.path) return false;
      if (referenced.has(object.path)) return false;

      // No usable timestamp means no way to tell a long-dead orphan from a
      // photo uploaded a second ago, and this step deletes things. Keep it
      // and let a later run - by which time the listing has presumably
      // recovered - decide.
      const createdAt = toMillis(object.createdAt);
      if (createdAt === null) return false;

      return nowMs - createdAt >= gracePeriodMs;
    })
    .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt))
    .map((object) => object.path);
}

function toMillis(value) {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
