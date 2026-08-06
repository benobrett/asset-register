// Scheduled sweep for Storage objects that nothing points at any more.
//
// Two known sources, both accepted trade-offs rather than bugs (see
// CLAUDE.md): asset_photos rows cascade away when an asset is deleted
// without touching the files behind them, and deleteSyncedPhoto() removes
// the row before the object on purpose, so a failure between the two leaves
// a file rather than a broken thumbnail.
//
// This is the one piece of this project that runs outside the browser and
// outside Postgres. It has to be: deleting a Storage object needs the
// Storage API, and deleting the storage.objects row from SQL would leave
// the bytes behind - the same orphan one level down.
//
// Deployment and scheduling are by hand, same as migrations/. See README.md
// in this directory.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { selectOrphans, DEFAULT_GRACE_PERIOD_MS } from './orphans.js';

const PHOTO_BUCKET = 'asset-photos';
// Supabase Storage's list() caps out at 1000 per call.
const LIST_PAGE_SIZE = 1000;
// remove() takes an array; keep each request a sane size.
const DELETE_BATCH_SIZE = 100;

Deno.serve(async (request: Request) => {
  // A dedicated secret rather than the service role key, so whatever
  // schedules this doesn't have to hold a credential that can do anything
  // at all to the database, and rotating one doesn't touch the other.
  const expectedSecret = Deno.env.get('CLEANUP_SECRET');
  if (!expectedSecret) {
    return json({ error: 'CLEANUP_SECRET is not configured' }, 500);
  }
  if (request.headers.get('x-cleanup-secret') !== expectedSecret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // dryRun reports what it would delete and deletes nothing. The first run
  // against a real bucket should always use it - this is the only code in
  // the project that deletes files it wasn't explicitly pointed at.
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === 'true';
  const gracePeriodMs = Number(url.searchParams.get('gracePeriodMs') ?? DEFAULT_GRACE_PERIOD_MS);
  // Opt out of the empty-register guard below, and *only* that guard - the
  // grace period and the undateable-object rule still apply. Needed because
  // an empty register is genuinely normal in the e2e project, where every
  // spec deletes the asset it created.
  const allowEmptyRegister = url.searchParams.get('allowEmptyRegister') === 'true';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    // Service role: listing the whole bucket and deleting from it is
    // deliberately not something the app's RLS policies allow. It lives in
    // this function's environment, never in the repository.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const [objects, referencedPaths] = await Promise.all([
      listAllObjects(supabase),
      listReferencedPaths(supabase),
    ]);

    // "Nothing is referenced" and "everything here is rubbish" look
    // identical from here, and only one of them is ever true in practice.
    // A bucket with files but no rows pointing at them is the signature of
    // a misconfiguration - wrong project, renamed table, a policy change
    // that made the select return nothing - and acting on it would empty
    // the bucket. Refuse and let a human look.
    //
    // It is not *always* wrong, though: the e2e project reaches exactly
    // this state legitimately, because every spec deletes the asset it
    // created and the cascade takes the photo rows with it. Hence the
    // override - opt-in, named for what it asserts rather than "force",
    // and narrow enough that it can't switch off anything else.
    if (objects.length > 0 && referencedPaths.length === 0 && !allowEmptyRegister) {
      return json(
        {
          error:
            'Refusing to run: the bucket has objects but asset_photos returned no rows. ' +
            'That is far more likely to be a misconfiguration than a genuinely empty register. ' +
            'If the register really is empty, re-run with allowEmptyRegister=true.',
          scanned: objects.length,
        },
        409
      );
    }

    const orphans = selectOrphans({
      objects,
      referencedPaths,
      now: Date.now(),
      gracePeriodMs,
    });

    if (dryRun) {
      return json({
        dryRun: true,
        scanned: objects.length,
        referenced: referencedPaths.length,
        orphaned: orphans.length,
        paths: orphans,
      });
    }

    let deleted = 0;
    for (let i = 0; i < orphans.length; i += DELETE_BATCH_SIZE) {
      const batch = orphans.slice(i, i + DELETE_BATCH_SIZE);
      const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(batch);
      // Stop rather than carry on: a failure here is far more likely to be
      // "the credential or the bucket is wrong" than one bad path, and
      // grinding through the remaining batches would just repeat it.
      if (error) throw error;
      deleted += batch.length;
    }

    return json({
      scanned: objects.length,
      referenced: referencedPaths.length,
      deleted,
    });
  } catch (err) {
    console.error('Orphan cleanup failed:', err);
    // Deliberately not echoing the error message back to the caller - it
    // can carry connection details. It's in the function logs.
    return json({ error: 'Cleanup failed; see the function logs.' }, 500);
  }
});

// Photos are stored at <userId>/<uuid>.jpg (buildPhotoPath in camera.js),
// so the bucket root holds one folder per user and list() has to descend
// into each. It isn't recursive, and a folder entry is distinguishable from
// a file by having no id.
async function listAllObjects(supabase: ReturnType<typeof createClient>) {
  const objects: Array<{ path: string; createdAt: string | null }> = [];

  for (const prefix of await listPage(supabase, '', true)) {
    for (const file of await listPage(supabase, prefix.name, false)) {
      objects.push({
        path: `${prefix.name}/${file.name}`,
        createdAt: file.created_at ?? null,
      });
    }
  }

  return objects;
}

async function listPage(
  supabase: ReturnType<typeof createClient>,
  path: string,
  foldersOnly: boolean
) {
  const found: Array<{ name: string; created_at?: string | null }> = [];

  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .list(path, { limit: LIST_PAGE_SIZE, offset });
    if (error) throw error;
    if (!data?.length) break;

    for (const entry of data) {
      const isFolder = entry.id === null || entry.id === undefined;
      if (isFolder === foldersOnly) found.push(entry);
    }

    if (data.length < LIST_PAGE_SIZE) break;
  }

  return found;
}

// Every path the database still knows about. Paged explicitly: PostgREST
// caps a response at 1000 rows, and silently reading only the first page
// would make every photo past it look orphaned.
async function listReferencedPaths(supabase: ReturnType<typeof createClient>) {
  const paths: string[] = [];
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('asset_photos')
      .select('storage_path')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      if (row.storage_path) paths.push(row.storage_path);
    }
    if (data.length < PAGE) break;
  }

  return paths;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
