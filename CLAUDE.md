# CLAUDE.md

## Project overview
A progressive web app for cataloging physical assets, used on a Chromebook tablet in the field. After logging in, a user can either capture a brand-new asset (photo + details) or pull up an existing one, track repairs against it, and discuss those repairs in a comment thread — all within a single PWA. No separate capture app, register app, or "review site"; it's one tool with a few views. Must work fully offline and sync once reconnected.

## Keeping this file current
CLAUDE.md is read as ground truth for how this project works — a stale section here produces wrong code, not just confusion. That's what happened before this section existed: the file described a pre-scaffolding plan long after the app had moved on, and an AI assistant reading it as current would reach for a table, an auth call, or a file that no longer (or never did) match reality.

Update this file in the same PR as any change to:
- the database schema, RLS policies, or triggers
- routing, or the auth/profile gates in `main.js`
- environment variables
- the file structure — new modules, new views, anything removed
- the build, test, lint, CI, or deploy setup
- any convention a future contributor would otherwise have to infer from reading the source

Bug fixes and UI changes that don't alter any of the above don't need an update. If a PR does change one of them and this file wasn't touched, treat that as an incomplete PR.

## Tech stack
- **Frontend**: vanilla HTML/CSS/JS — no UI framework. Bundled with [Vite](https://vite.dev) for its dev server, env var handling, and build step only.
- **Backend**: [Supabase](https://supabase.com) — Postgres for asset/repair/comment/profile records, Storage for photos, Auth for login. No custom server; every "backend" behavior lives in Postgres itself (RLS policies, triggers, CHECK constraints) or in the Supabase client SDK.
- **Offline**: `vite-plugin-pwa` (wraps Workbox) for app-shell caching, plus an IndexedDB queue (via [`idb`](https://www.npmjs.com/package/idb)) for records/photos captured while offline.
- **Camera**: `<input type="file" accept="image/*" capture="environment">` — see "Camera capture" below.
- **Testing**: [Vitest](https://vitest.dev), with [`fake-indexeddb`](https://www.npmjs.com/package/fake-indexeddb) for `db.js`/`sync.js`. See "Testing conventions".
- **Linting**: ESLint, run in CI on every PR.
- **Hosting**: GitHub Pages. Every merge to `main` builds and deploys automatically — see "Git workflow & CI/CD".

## User flow
1. **Login** — email/password (see "Authentication"). A brand-new signup also collects first/last name.
2. **Name prompt, if needed** — an account that reaches this point with no name on file (a pre-existing account, or a future non-form sign-in path) is blocked here until it provides one. See "Routing and auth/profile gates".
3. **Assets** (`#/register`) — the landing screen after login. Search/browse/sort the register, or start a new asset.
4. **New asset** (`#/capture`) — photo + details, with any repairs already known about it.
5. **Asset detail** (`#/asset/:id`) — view/edit an asset, and its full repair log: add a repair, edit it, mark it complete, and discuss it in a per-repair comment thread.

There is no separate "Home" screen — `#/register` is where every login lands.

## Development environment
Built on Windows, running on a Chromebook (ChromeOS/Chrome) in the field. Being a PWA, this is mostly a non-issue — Chrome on Windows and Chrome on ChromeOS render identically — but a few things to keep in mind:
- **Test the camera on the real device.** A Windows laptop's webcam is usually front-facing only, so `capture="environment"` can't be meaningfully verified there — confirm capture behavior periodically on the actual Chromebook tablet.
- **`.gitattributes`** normalizes line endings to LF (`* text=auto eol=lf`), so Windows' CRLF default doesn't create noisy diffs against the Linux-based GitHub Actions runners.
- **Keep npm scripts cross-platform** — avoid bash-only syntax; if a script needs Unix-style commands or env vars, use a cross-platform package (`rimraf`, `cross-env`) rather than assuming a Unix shell.
- **SQL that has to travel through a non-terminal channel** (pasted into chat, a browser, etc.) before reaching the Supabase SQL editor has repeatedly had its quote characters mangled in transit — both `''` quote-doubling and `$tag$` dollar-quoting have failed this way. Prefer plain string concatenation with `chr(39)` for a literal apostrophe instead (see the `profiles` CHECK constraints in `schema.sql`), and keep each statement to one physical line where practical — line breaks inside a single statement have also been silently turned into statement boundaries by this same path.

## Architecture
```
/
├── index.html              Entry point
├── public/                 Static assets served as-is (currently just the Quicksand font's OFL licence text — no PWA icons yet, see the TODO in vite.config.js)
├── src/
│   ├── main.js              Hash-based routing (no router library) + the auth/profile gates — see "Routing and auth/profile gates"
│   ├── auth.js              Login/signup/session, plus profile-completeness helpers (getProfile, isProfileComplete, submitProfileName)
│   ├── camera.js            Thin wrapper around the file input's photo preview + path naming
│   ├── db.js                IndexedDB offline queue
│   ├── sync.js              Pushes the queue to Supabase on reconnect
│   ├── supabase.js          Supabase client init + signed photo URLs
│   ├── validation.js        Pure, unit-tested form-validation logic
│   ├── format.js            Small display-formatting helpers (e.g. the "Item-01" asset ID)
│   ├── confirmDialog.js     Promise-based confirm/cancel modal (see "View pattern" below)
│   ├── assets/              Logo + font, imported from JS/CSS (not referenced from public/) so Vite base-prefixes them correctly under GitHub Pages' subpath
│   ├── views/
│   │   ├── login.js           Login, and signup (first name, last name, email, password, in that order)
│   │   ├── completeProfile.js Blocking post-login name prompt for an account with no name on file
│   │   ├── register.js        Search/browse/sort the asset register; delete an asset
│   │   ├── capture.js         New asset form + photo capture
│   │   └── detail.js          View/edit an asset; the repair + comment workflow
│   └── style.css
├── tests/                  Vitest specs — one file per src module under test
├── migrations/             Incremental SQL actually run against the live Supabase project, in the order it was run
├── schema.sql              Full current schema — see "Data model" for how this relates to migrations/
├── .github/
│   └── workflows/
│       ├── ci.yml            Lint + test on every PR
│       └── deploy.yml        Build + deploy to GitHub Pages on every push to main
├── vite.config.js
├── .gitattributes
├── .env                    Supabase URL + publishable key (gitignored)
├── package.json
├── README.md               Project overview for a human reader (features, setup) — CLAUDE.md covers conventions instead
└── CLAUDE.md
```

### View pattern
There's no component framework, so every view follows the same shape: a function `(container, { navigate, params }) => void` that renders its own HTML into `container` via a template string, then wires up event listeners by querying the DOM it just wrote. A view whose state changes after user interaction (opening an edit form, expanding a repair's comment thread, etc.) doesn't patch the DOM — it re-runs its own `drawView()`-style function, which re-renders the whole template from current state and re-wires everything from scratch. This is simple at the cost of being coarse-grained; it's a deliberate trade-off for an app this size, not an oversight.

`confirmDialog({ message })` is the one shared UI primitive outside this pattern: it builds its own backdrop/modal, appends it to `document.body` directly (not into a view's `container`), and returns a Promise that resolves `true` on confirm or `false` on cancel/backdrop-click/Escape. Views awaiting it don't need to render or tear down anything themselves.

`validation.js` holds every form's validation as a pure function (`validateAssetForm`, `validateRepairForm`, `validateNameForm`) — no DOM, no Supabase — so it can be unit tested directly and reused wherever the same rules apply twice (`validateNameForm` is shared between the signup form and the post-login name prompt, which is exactly why it lives here instead of inline in either view).

## Routing and auth/profile gates
`main.js` has no router library: it matches `window.location.hash` against a small ordered list of `{ pattern (RegExp), view }` entries and calls the matching view function. `navigate(hash)` either re-runs the current route directly (if the hash isn't changing, so a click back to the current screen still refreshes it) or sets `window.location.hash`, which fires the `hashchange` listener that calls `route()`.

Before any route renders, `route()` runs through gates in this order:
1. **No session, and the hash isn't `#/login`** → redirect to `#/login`.
2. **Session exists, and the hash is `#/login`** → redirect to `#/register` (the default landing screen).
3. **Stale `#/home` bookmarks/history** → redirected to `#/register`; the Home screen doesn't exist.
4. **Session exists, the hash isn't `#/complete-profile`, and the account's profile is incomplete** (`isProfileComplete()` in `auth.js`) → redirect to `#/complete-profile`, blocking every other route until it's satisfied.
5. **Session exists, the hash *is* `#/complete-profile`, but the profile is already complete** → redirect to `#/register` (covers a stale bookmark or the back button after already completing it).

Gate 4 is the one most likely to trip up a future change, so a few things worth knowing about it:
- The completeness check is **cached per session** (`profileCompleteCache` in `auth.js`), not re-queried on every hash change. The cache resets whenever the session changes (`onAuthChange`), and is set directly to "complete" the moment `completeProfile.js` successfully calls `submitProfileName()` (`markProfileComplete()`), rather than waiting on a fresh query that would just re-confirm what the view already knows.
- It **deliberately fails open**: if the profile query itself errors — a network blip, or this migration not yet having been applied — `isProfileComplete()` returns `true` rather than blocking the whole app. This is an onboarding nicety, not access control, and the app's whole premise is field reliability; a broken query here should never be the thing that locks a field worker out of logging an asset.

## Data model (Supabase / Postgres)
`schema.sql` is the full current schema and the thing to read for exact column lists — this section covers the shape and the reasoning, not a column-by-column copy that will only go stale again.

**`migrations/` vs `schema.sql`**: `migrations/` holds the incremental SQL that was actually run against the live Supabase project, numbered in the order it was run (`0001_...`, `0002_...`, ...). `schema.sql` is the full current picture, kept in sync by hand whenever a migration lands. Neither is auto-applied anywhere — there's no migration runner. When a change needs to reach the live database, write the migration file, run it directly in the Supabase SQL editor, and fold the same change into `schema.sql`.

### Tables
- **`assets`** — one row per logged asset: name, description, photo path, recorded date/time, plus `created_by`/`created_at`/`updated_at`. `asset_number` is a sequence-backed `generated always as identity` column, formatted client-side into the user-facing "Item-01" ID (`format.js`) — assigned atomically at insert time and never reused, even after a delete.
- **`asset_repairs`** — a repair log per asset, not a single flag: an asset can have several repair records over its life, each independently editable and markable complete. `on delete cascade` on `asset_id` so deleting an asset atomically removes its repair history at the DB level. `created_by_email`/`updated_by_email`/`completed_by_email` are snapshotted at each of those actions — `auth.users` isn't queryable client-side under RLS, so the email is captured directly rather than joined later.
- **`repair_comments`** — a comment thread per repair (oldest first), not a single field: the optional comment on marking a repair complete is just that thread's first entry, not a separate column. `created_by_email` and `created_by_name` are both snapshotted at comment-creation time for the same reason as above — there's no client-side access to look up *another* user's name after the fact, only your own. `created_by_name` is null for a comment left by an account with no name on file yet; the UI falls back to `created_by_email` in that case.
- **`profiles`** — one row per `auth.users` account: `first_name`, `last_name`, both nullable. Nullable is deliberate — mandatory-ness for a *new* signup is an application-layer rule (the signup form, re-enforced by the CHECK constraints below), not a database one, because every pre-existing account starts with no name on file by design, not by error. A partial index (`profiles_missing_name_idx`, `where first_name is null or last_name is null`) supports counting how many accounts still need the post-login prompt.
- **`asset_comments`** — a general per-asset comment log, distinct from `repair_comments`. Created early on but **not currently wired into any view** — no code under `src/` reads or writes it. Left in place rather than dropped; if a future issue asks for asset-level (as opposed to repair-level) comments, this table is already there.

### Triggers
- **`set_updated_at()` / `assets_set_updated_at`** — `default now()` on `updated_at` only fires on insert, not on later edits; without this `before update` trigger, `assets.updated_at` would silently keep showing the creation time forever, even after a real edit.
- **`handle_new_user()` / `on_auth_user_created`** — a `security definer` trigger, `after insert on auth.users`, that creates the matching `profiles` row for every new account the moment it's created. This exists because there's no authenticated session (and so no RLS access) at that point — the account isn't confirmed yet. It reads `first_name`/`last_name` out of the metadata `signUp()` attaches via its `options.data` (see "Authentication"); an account created any other way (see the Google sign-in note below) simply has no such metadata, so the row ends up with null names — which is exactly what puts that account through the same post-login prompt as a genuinely pre-existing legacy account. `security definer` is what lets the insert bypass RLS, since it runs as the trigger's owner rather than the brand-new user.

### Row Level Security
Two different patterns are in use, and the difference is deliberate:
- **`assets`, `asset_comments`, `asset_repairs`, `repair_comments`** all use the same shared policy: `using (auth.uid() is not null) with check (auth.uid() is not null)`. This is a shared register — every logged-in user sees and can edit every asset/repair/comment, not just their own. `created_by`/`created_by_email` columns are kept for an audit trail, not for restricting access. Tighten this later if that ever needs to change (e.g. per-department visibility).
- **`profiles`** is scoped per-user instead, because it holds personal account data, not shared organizational data: `select`/`insert` are restricted to `auth.uid() = id`, and `update` is further restricted to rows where `first_name is null and last_name is null` — so `submitProfileName()` in `auth.js` can only ever *fill in* a name, never silently overwrite one that's already set. (It first tries an `insert`; if that fails on a unique-violation because the signup trigger already created the row, it falls back to that guarded `update`, and treats zero rows affected as "this account already has a name" rather than a generic failure.)

Never put the Supabase *service role* key anywhere in this codebase — it bypasses RLS entirely and belongs only on a server this project doesn't have. Only the publishable (anon) key belongs in client code.

## Authentication
Email/password via Supabase Auth (`supabase.auth.signUp` / `signInWithPassword`, in `src/auth.js`), used from `src/views/login.js`:
- Signup collects **first name, last name, email, password**, in that order. First/last name are validated client-side (`validateNameForm` in `validation.js` — trimmed length 1–50, letters/spaces/hyphens/apostrophes and accented/non-Latin characters only) and re-enforced by the `profiles` CHECK constraints server-side, so a request that bypasses the form is still rejected.
- `signUp()` passes an explicit `emailRedirectTo` (`${window.location.origin}${import.meta.env.BASE_URL}`) rather than relying on the Supabase dashboard's single "Site URL" setting — without it, the confirmation email's link would only ever point at whichever environment (local dev vs. the deployed GitHub Pages URL) was configured there last.
- First/last name travel into `signUp()`'s `options.data`, landing in `auth.users.raw_user_meta_data` — not written directly to `profiles`, because there's no session yet to satisfy RLS at that point. The `handle_new_user()` trigger (see "Data model") is what actually creates the `profiles` row from that metadata.
- An account that reaches the app with no name on file — a pre-existing account from before this existed, or (see below) a future non-form sign-in path — is blocked by the routing gate and shown `completeProfile.js` before it can go any further. That view reuses the same `validateNameForm` and calls `submitProfileName()`.

**Future: Google sign-in.** Still on the roadmap, not yet implemented — there's no `signInWithOAuth` call anywhere in the codebase today. When it's added, the `profiles` trigger already covers it with no changes needed: an OAuth sign-in creates an `auth.users` row with no `first_name`/`last_name` metadata, so it lands with a null-named `profiles` row and goes through the same post-login prompt as a legacy account. What's left is only the provider swap (`supabase.auth.signInWithOAuth({ provider: 'google' })`) and a one-time setup step outside the codebase: enabling the Google provider in the Supabase dashboard and registering OAuth credentials in Google Cloud Console. If this is ever restricted to one organization's staff, Google's `hd` parameter can lock sign-in to a specific Workspace domain.

## Offline strategy
1. A session is required to log in at least once while online; Supabase's client SDK caches that session locally, so the app stays "logged in" offline afterward.
2. Every save writes to IndexedDB first (`db.js`), tagged `synced: false`, using a client-generated UUID as the record's `id` — the same UUID Supabase will store, so there's no ID-reconciliation step later: the client already knows the id the row will have before it's ever synced.
3. `db.js` follows one naming pattern per queued entity — `queue<Entity>`, `getUnsynced<Entity>s`, `mark<Entity>Synced` (e.g. `queueAsset`/`getUnsyncedAssets`/`markAssetSynced`) — currently for assets, repairs, and repair comments. Follow the same shape for any future queued entity.
4. If online, `sync.js`'s `syncAll()` runs immediately after queuing: assets, then repairs, then repair comments, in that order — each references the row before it as a foreign key, so syncing out of order would fail. Asset photos upload to Storage as part of the asset sync step; mark `synced: true` (by removing the record from its queue store) on success.
5. If offline, the record sits in the queue. A listener on `window.addEventListener('online', ...)`, plus a check on app load, retries anything still unsynced.
6. IndexedDB stores Blobs directly, so the photo itself — not just its metadata — survives offline until it syncs.
7. Per-record sync failures are caught and left queued rather than thrown — a dropped connection mid-sync is an expected condition here, not a bug. `vite-plugin-pwa` separately caches the app shell (HTML/CSS/JS) so the app loads at all with no connection.
8. **Known limitation:** if the same asset is edited offline in one session while also edited online elsewhere before the first sync completes, whichever sync lands last wins silently — there's no conflict detection. Not a practical risk with a single user; worth addressing (e.g. comparing `updated_at` before overwriting, or flagging the conflict for manual review) if this becomes genuinely multi-user.

## Camera capture
Using `<input type="file" accept="image/*" capture="environment">` rather than a hand-built `getUserMedia()` live preview:
- Delegates to the Chromebook's native camera app — better focus/exposure than a custom capture, for free.
- Far less code, far fewer device-specific edge cases (stream permissions, cleanup, orientation) to debug.
- Returns a `File` either way — the offline queue doesn't care which method produced it.
- Trade-off: briefly leaves the app for the OS camera UI instead of a live in-app preview. If that friction matters once this is in real use, `getUserMedia()` is a reasonable v2 — a swap-in replacement, nothing downstream needs to change.
- Confirm the specific Chromebook tablet model has a usable rear camera — some cheaper ones only have a front-facing one meant for video calls.

## Environment variables
`.env` (gitignored) holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Vite exposes these to client code via `import.meta.env`. `.env.example` documents both names with empty values — copy it to `.env` and fill them in.

## Testing conventions
- Vitest for unit tests, in `tests/` — one file per `src` module under test (`auth.test.js`, `db.test.js`, `format.test.js`, `sync.test.js`, `validation.test.js`).
- Test pure logic: form validation (`validation.js`), the offline queue and its sync (`db.js`/`sync.js`, mocking the Supabase client), the profile-completeness cache and its fail-open behavior (`auth.js`). Don't unit test camera hardware, real network calls, or the OAuth redirect itself.
- IndexedDB isn't available outside a browser — `fake-indexeddb` is already in use to test `db.js`/`sync.js` under Vitest.
- No view (`src/views/*`) is currently unit tested — they're exercised manually in the browser instead, consistent with the "don't unit test the DOM/hardware/network" rule above extending to UI wiring in general.
- Run `npm test` and `npm run lint` before opening a PR.

## Git workflow & CI/CD
- `main` is protected: no direct pushes, PRs only.
- Branch protection requires a passing CI check before merge. (A required approving review is worth adding once there's more than one contributor — with a single person, GitHub won't let you approve your own PR, so that specific rule would block every merge until then.)
- One branch per change: `feature/short-description`, `fix/short-description`, or `docs/short-description`.
- `.github/workflows/ci.yml` runs on every PR:
```yaml
name: CI
on: pull_request
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm test
```
- `.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main` (plus a manual `workflow_dispatch` trigger), reading the Supabase env vars from repo secrets of the same name:
```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/deploy-pages@v4
```

## Commands
- `npm run dev` — Vite dev server
- `npm run build` — production build (also used by the deploy workflow)
- `npm run preview` — serve the production build locally
- `npm test` — run Vitest once
- `npm run test:watch` — Vitest watch mode
- `npm run lint` — ESLint
