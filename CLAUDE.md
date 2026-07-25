# CLAUDE.md

## Project overview
A progressive web app for cataloging physical assets, used on a Chromebook tablet in the field. After logging in, a user can either capture a brand-new asset (photo + details) or pull up an existing one and update its fields, then review it — all within a single PWA. No separate capture app, register app, or "review site"; it's one tool with a few views. Must work fully offline and sync once reconnected.

## Tech stack
- **Frontend**: vanilla HTML/CSS/JS — no UI framework. Bundled with [Vite](https://vite.dev) for its dev server, env var handling, and build step only.
- **Backend**: [Supabase](https://supabase.com) — Postgres for asset records, Storage for photos, Auth for login.
- **Offline**: `vite-plugin-pwa` (wraps Workbox) for app-shell caching, plus an IndexedDB queue (via [`idb`](https://www.npmjs.com/package/idb)) for records/photos captured while offline.
- **Camera**: `<input type="file" accept="image/*" capture="environment">` — see "Camera capture" below.
- **Testing**: [Vitest](https://vitest.dev) for unit tests.
- **Linting**: ESLint, run in CI on every PR.
- **Hosting**: not yet decided — Netlify, Vercel, or GitHub Pages all pair well with the CI/CD below.

## User flow
1. **Login** — Google sign-in (see "Authentication").
2. **Home** — choice of:
   - **New asset**: capture a photo, fill in its fields, save.
   - **Existing asset**: search/browse the register, pick one, update its fields.
3. **Review** — view any asset's photo + fields, in the same PWA (no separate "site" for this, just a view).

## Development environment
Built on Windows, running on a Chromebook (ChromeOS/Chrome) in the field. Being a PWA, this is mostly a non-issue — Chrome on Windows and Chrome on ChromeOS render identically — but a few things to keep in mind:
- **Test the camera on the real device.** A Windows laptop's webcam is usually front-facing only, so `capture="environment"` can't be meaningfully verified there — confirm capture behavior periodically on the actual Chromebook tablet.
- **Add a `.gitattributes`** normalizing line endings to LF (`* text=auto eol=lf`), so Windows' CRLF default doesn't create noisy diffs against the Linux-based GitHub Actions runners.
- **Keep npm scripts cross-platform** — avoid bash-only syntax; if a script needs Unix-style commands or env vars, use a cross-platform package (`rimraf`, `cross-env`) rather than assuming a Unix shell.

## Architecture
```
/
├── index.html            Entry point
├── public/               Static assets (icons, etc.)
├── src/
│   ├── main.js            App entry, routing between views
│   ├── auth.js            Login/logout, session handling
│   ├── camera.js          Photo capture logic
│   ├── db.js              IndexedDB helpers (offline queue)
│   ├── sync.js            Pushes queued records/photos to Supabase on reconnect
│   ├── supabase.js        Supabase client init
│   ├── views/
│   │   ├── login.js        Login screen
│   │   ├── home.js         New vs. existing asset choice
│   │   ├── capture.js      New asset form + photo capture
│   │   ├── register.js     Search/browse existing assets
│   │   └── detail.js       Review + edit a single asset
│   └── style.css
├── tests/
│   └── *.test.js          Vitest unit tests
├── .github/
│   └── workflows/ci.yml   Test + lint on every PR
├── vite.config.js
├── .gitattributes
├── .env                   Supabase URL + anon key (gitignored)
├── package.json
└── CLAUDE.md
```
Nothing above exists yet except this file — this is the intended shape once scaffolding starts.

## Data model (Supabase / Postgres)
```sql
create table assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  location text,
  condition text check (condition in ('good', 'fair', 'poor', 'damaged')),
  serial_number text,
  notes text,
  photo_path text,                          -- object path in Supabase Storage
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
Photos live in a Storage bucket (e.g. `asset-photos`); `photo_path` stores the object path, and the app derives a URL at render time.

**Row Level Security, gated on login:**
```sql
alter table assets enable row level security;

create policy "Logged-in users can manage all assets"
  on assets for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
```
This is a shared register — every logged-in user sees and can edit every asset, not just their own. `created_by` is kept for an audit trail, not for restricting access. Tighten this later if that ever needs to change (e.g. per-department visibility).

Never put the Supabase *service role* key anywhere in this codebase — it bypasses RLS entirely and belongs only on a server this project doesn't have. Only the anon key belongs in client code.

## Authentication
Google sign-in via Supabase Auth (`supabase.auth.signInWithOAuth({ provider: 'google' })`), because:
- A Chromebook is already tied to a Google account — this is a one-tap login with nothing to type, and no passwords to manage or reset.
- Supabase handles the OAuth flow and session persistence; there's no custom session code to write.
- If this is ever restricted to one organization's staff, Google's `hd` parameter can lock sign-in to a specific Workspace domain.

Requires a one-time setup step outside the codebase: enabling the Google provider in the Supabase dashboard and registering OAuth credentials in Google Cloud Console. If that setup is unwanted, email/password via Supabase Auth is a straightforward fallback — swap the provider, the rest of the auth flow (session handling, RLS) is unchanged.

## Offline strategy
1. A session is required to log in at least once while online; Supabase's client SDK caches that session locally, so the app stays "logged in" offline afterward.
2. Every save writes to IndexedDB first, tagged `synced: false`, using a client-generated UUID as the record's `id` — the same UUID Supabase will store, so there's no ID-reconciliation step later.
3. If online, immediately try to upload the photo to Storage and insert/update the row in Postgres; mark `synced: true` on success.
4. If offline, the record sits in IndexedDB. A listener on `window.addEventListener('online', ...)`, plus a check on app load, retries any unsynced records.
5. IndexedDB stores Blobs directly, so the photo itself — not just its metadata — survives offline until it syncs.
6. `vite-plugin-pwa` caches the app shell (HTML/CSS/JS) so the app loads at all with no connection.

## Camera capture
Using `<input type="file" accept="image/*" capture="environment">` rather than a hand-built `getUserMedia()` live preview:
- Delegates to the Chromebook's native camera app — better focus/exposure than a custom capture, for free.
- Far less code, far fewer device-specific edge cases (stream permissions, cleanup, orientation) to debug.
- Returns a `File` either way — the offline queue doesn't care which method produced it.
- Trade-off: briefly leaves the app for the OS camera UI instead of a live in-app preview. If that friction matters once this is in real use, `getUserMedia()` is a reasonable v2 — a swap-in replacement, nothing downstream needs to change.
- Confirm the specific Chromebook tablet model has a usable rear camera — some cheaper ones only have a front-facing one meant for video calls.

## Environment variables
`.env` (gitignored) holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Vite exposes these to client code via `import.meta.env`.

## Testing conventions
- Vitest for unit tests, in `tests/` or alongside source as `*.test.js`.
- Test pure logic: sync-queue behavior, data validation, Supabase query builders (mock the client). Don't unit test camera hardware, real network calls, or the Google OAuth redirect itself.
- IndexedDB isn't available outside a browser — use [`fake-indexeddb`](https://www.npmjs.com/package/fake-indexeddb) to test `db.js`/`sync.js` under Vitest.
- Run `npm test` and `npm run lint` before opening a PR.

## Git workflow & CI/CD
- `main` is protected: no direct pushes, PRs only.
- Branch protection requires **at least one approving review** and a passing CI check before merge.
- One branch per change: `feature/short-description` or `fix/short-description`.
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

## Commands
Not yet set up — the intended scripts once `package.json` exists:
- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm test` — run Vitest once
- `npm run test:watch` — Vitest watch mode
- `npm run lint` — ESLint
