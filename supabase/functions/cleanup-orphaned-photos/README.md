# cleanup-orphaned-photos

A scheduled sweep that removes Storage objects nothing points at any more.

Nothing in this directory is deployed by CI. Like `migrations/`, it's applied
by hand — see "Deploying" below.

## Why it exists

Files accumulate in the `asset-photos` bucket with no `asset_photos` row
referencing them, from two accepted trade-offs (both explained in CLAUDE.md):

1. **Asset deletion.** `asset_photos` has `on delete cascade` on `asset_id`,
   so deleting an asset drops its photo rows at the database level without
   touching the files behind them.
2. **Partial photo deletion.** `deleteSyncedPhoto()` deletes the row *first*
   and the Storage object second, on purpose — the other order leaves a
   thumbnail pointing at a missing file if the second step fails. This order
   fails to an invisible orphan instead.

Neither is harmful. It's a storage bill that creeps up, which is why this is
a periodic sweep rather than anything inline.

## Why an Edge Function, in a project with no server

This is the only part of the project that runs outside the browser and
outside Postgres, so it's worth saying why it isn't SQL. Deleting a Storage
object needs the Storage API: removing the `storage.objects` row from SQL
leaves the bytes in the backing store — the same orphan, one level down.

The alternative was `pg_cron` + `pg_net` calling the Storage API from
Postgres, which would have kept everything in the database. It was rejected
on the practical hazard CLAUDE.md already records: SQL that has to travel
through a non-terminal channel to reach the SQL editor has repeatedly had
its quoting mangled, and that route needs request bodies full of quotes plus
a service-role credential in Vault. This way the credential is an
environment variable set through the dashboard and never appears in a
statement anyone has to paste anywhere.

## Safety

This is the only code in the project that deletes files it wasn't explicitly
pointed at, so it's built to refuse rather than guess:

- **A grace period** (24h by default). `sync.js` uploads an object *before*
  inserting its `asset_photos` row, so a healthy photo has no row for a
  moment — and for however long a device stays offline if that insert fails
  and the queue has to retry. Anything newer than the grace period is left
  alone.
- **Undateable objects are kept.** No usable `created_at` means no way to
  tell a long-dead orphan from a photo uploaded a second ago.
- **It aborts if `asset_photos` returns no rows while the bucket has
  objects** (409). That's usually the signature of a misconfiguration —
  wrong project, renamed table, a policy change — and acting on it would
  empty the bucket.

  It isn't always wrong, though. The **e2e project reaches this state
  legitimately**: every spec deletes the asset it created, and the cascade
  takes the photo rows with it, so zero rows plus a bucket full of stranded
  files is the normal steady state there. Re-run with
  **`?allowEmptyRegister=true`** to assert that the register really is
  empty. It's opt-in, named for what it asserts rather than `force`, and
  turns off *only* this check — the grace period and the undateable-object
  rule still apply.
- **`?dryRun=true`** reports what it would delete and deletes nothing. Use
  it for the first run against any project.
- **A dedicated `CLEANUP_SECRET`**, not the service role key, authorises a
  call — so whatever schedules this doesn't hold a credential that can do
  anything at all to the database, and rotating one doesn't touch the other.

`orphans.js` holds the decision logic as a pure function with no Deno,
Supabase or network in it, unit tested in `tests/orphans.test.js`. `index.ts`
does the listing, querying and deleting around it.

## Deploying

Needs the [Supabase CLI](https://supabase.com/docs/guides/cli) — this is the
only thing in the project that does.

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy cleanup-orphaned-photos
```

Then set the secret. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically; only the cleanup secret needs setting.

Generate it into `.env.cleanup` (gitignored) and set it from there, rather
than passing it on the command line — an inline value ends up in shell
history, and you need to keep a copy anyway to configure the cron job and
to call the function by hand:

```bash
node -e "console.log('CLEANUP_SECRET=' + require('crypto').randomBytes(32).toString('hex'))" > .env.cleanup
supabase secrets set --env-file .env.cleanup
```

**Never put that value, or the service role key, in this repository.**
`.env.cleanup` is gitignored for the same reason `.env` is.

## Scheduling

Supabase Dashboard → **Integrations → Cron** → *Create job*:

- Schedule: `0 3 * * 0` (weekly, 03:00 Sunday) is plenty — orphans are not
  urgent.
- Type: **Supabase Edge Function**, `cleanup-orphaned-photos`.
- Add an HTTP header `x-cleanup-secret` with the value set above.

## Two headers are required, not one

Easy to lose an hour to. Supabase's gateway enforces `verify_jwt` **before
the function runs at all**, so a request with only `x-cleanup-secret` is
rejected by the platform with
`{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` — which looks exactly like the
function's own 401 and isn't.

Every call needs both:

- `Authorization: Bearer <anon/publishable key>` — satisfies the platform.
- `x-cleanup-secret: <CLEANUP_SECRET>` — satisfies the function.

That's defence in depth rather than redundancy: the anon key is public, so
it gates nothing on its own; the secret is what actually authorises the
sweep. To tell the two 401s apart, check the body — the platform returns a
`code` field, the function returns `{"error":"Unauthorized"}`.

## Running it by hand

```bash
SECRET=$(grep '^CLEANUP_SECRET=' .env.cleanup | cut -d= -f2)
ANON=<your publishable/anon key>
URL="https://<project-ref>.supabase.co/functions/v1/cleanup-orphaned-photos"

# See what it would do, without deleting anything.
curl -s -H "Authorization: Bearer $ANON" -H "x-cleanup-secret: $SECRET" \
  "$URL?dryRun=true"

# For real.
curl -s -H "Authorization: Bearer $ANON" -H "x-cleanup-secret: $SECRET" "$URL"
```

Response: `{ scanned, referenced, deleted }`, or the same with
`dryRun: true` and a `paths` array.

Query parameters: `dryRun`, `allowEmptyRegister` (see "Safety"), and
`gracePeriodMs` — the last is useful in the e2e project, where a test's
leftovers are minutes old rather than days.
