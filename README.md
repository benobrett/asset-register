# Asset Register

A progressive web app for cataloging physical assets at the Brook Waimārama
Sanctuary. Field staff use it on a Chromebook tablet to log new assets with a
photo, track repairs against them, and add comments — all in one app, and all
working fully offline, syncing automatically once a connection comes back.

Live app: https://benobrett.github.io/asset-register/

## What it does

- **Log in** with email/password (Google sign-in is supported by the data
  model but not yet wired up in the UI).
- **Add a new asset**: name, description, date/time, and an optional photo
  taken with the device's camera.
- **Browse/search the register**: a card list on phone-width screens, a
  denser table on wider ones (a Chromebook tablet), sortable, with an
  outstanding-repairs filter.
- **View and edit an asset**, including its full repair history.
- **Log a repair** against an asset, edit it, and mark it complete (with an
  optional comment).
- **Comment on a repair**: a full threaded discussion per repair, shown
  inline (expands the repair record in place), with just the latest comment
  previewed when collapsed. Shows the commenter's name, falling back to
  their email if they haven't set one.
- **First-time name capture**: signup collects first/last name up front;
  anyone who already had an account is prompted for their name once, right
  after login, before they can use the rest of the app.
- **Works offline**: every save lands in an on-device queue first and syncs
  to the server the moment a connection is available — nothing is lost by
  losing signal mid-task.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS, no framework | Small app, small team — a framework buys little and costs a dependency |
| Build/dev server | [Vite](https://vite.dev) | Fast dev server, env var handling, production bundling |
| Backend | [Supabase](https://supabase.com) | Postgres (data), Storage (photos), Auth (login) — no custom server to run or host |
| Offline queue | [`idb`](https://www.npmjs.com/package/idb) (IndexedDB) | Every save is queued locally first, keyed by a client-generated UUID that Supabase reuses on sync |
| Offline app shell | [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/) (Workbox) | Caches HTML/CSS/JS so the app loads with no connection at all |
| Camera | `<input type="file" capture="environment">` | Delegates to the device's native camera app instead of a hand-rolled live preview |
| Tests | [Vitest](https://vitest.dev) + [`fake-indexeddb`](https://www.npmjs.com/package/fake-indexeddb) | Pure logic and the offline queue are unit tested; camera/network/OAuth are not |
| Hosting | GitHub Pages | Free, deploys automatically on merge to `main` |

## How it's put together

### Routing (`src/main.js`)

There's no router library — `main.js` matches `window.location.hash` against
a small list of regex patterns and calls the matching view function. Before
any route renders, it runs through a few gates in order:

1. No session → redirect to `#/login` (except the login route itself).
2. Session but on `#/login` → redirect to `#/register` (the default landing
   screen; there's no separate "home" screen).
3. Session but the account has no name on file → redirect to
   `#/complete-profile` and block every other route until it's submitted.
   This check is cached per session (so it isn't re-queried on every
   navigation) and **fails open** — a query error here never locks anyone
   out of the app, since this is an onboarding nicety, not access control.

### Views (`src/views/`)

Each view is a plain function `(container, { navigate, params }) => void`
that renders its own HTML into `container` and wires up its own event
listeners — no virtual DOM, no component framework. A view that needs to
re-render after a state change (e.g. opening an edit form) just re-runs its
own `drawView()`-style function and re-queries the DOM it just wrote.

| View | Route | Purpose |
|---|---|---|
| `login.js` | `#/login` | Log in, or sign up (with first/last name) |
| `completeProfile.js` | `#/complete-profile` | Blocking name-capture prompt for accounts with no name on file |
| `register.js` | `#/register` | Search/browse/sort the asset register; delete an asset |
| `capture.js` | `#/capture` | Log a new asset (+ any repairs already known about it) |
| `detail.js` | `#/asset/:id` | View/edit an asset; the full repair + comment workflow lives here |

### Offline strategy (`src/db.js`, `src/sync.js`)

1. A session, once established online, is cached by the Supabase client SDK,
   so the app stays "logged in" offline afterward.
2. Every save (`queueAsset`/`queueRepair`/`queueRepairComment`) writes to an
   IndexedDB store first, using a client-generated UUID as the record's id —
   the same UUID Supabase stores, so there's no reconciliation step once it
   syncs.
3. If online, `syncAll()` runs immediately after queuing: assets, then
   repairs, then repair comments, in that order (each references the row
   before it as a foreign key). Photos upload to Supabase Storage as part of
   the asset sync step.
4. If offline, the record just sits in the queue. A `window.online` listener
   plus a check on app load retries anything still unsynced.
5. Per-record sync failures are caught and left queued rather than thrown —
   a dropped connection mid-sync is an expected condition here, not a bug.

### Auth & profiles (`src/auth.js`)

Supabase Auth handles sessions; `profiles` (see below) is a separate table
for the one thing Auth doesn't store: first/last name. A Postgres trigger
creates a `profiles` row for every new `auth.users` account automatically —
this covers both the app's signup form and any future OAuth sign-in path
uniformly, since it fires regardless of how the account was created.

### Data model (Supabase / Postgres — full detail in `schema.sql`)

```
assets            one row per logged asset (name, description, photo, date)
asset_repairs     repair history for an asset (description, reported/completed dates, who did what)
repair_comments   threaded comments per repair (text, author snapshot, date)
profiles          first/last name per auth.users account (nullable — filled in at signup or via the prompt)
```

Row Level Security is on throughout. Assets/repairs/comments use a shared
"any logged-in user can read and write everything" policy — this is a
shared register, not a personal one. `profiles` is scoped to each user's own
row instead, and its update policy specifically blocks overwriting a name
that's already set.

`migrations/` holds the incremental SQL run directly against the live
Supabase project as features shipped; `schema.sql` is the current full
picture, kept in sync but not itself auto-applied anywhere.

## Project structure

```
/
├── index.html
├── src/
│   ├── main.js            Routing + the auth/profile gates
│   ├── auth.js             Login/logout, session + profile-completeness helpers
│   ├── camera.js           Photo capture (thin wrapper over the file input)
│   ├── db.js               IndexedDB offline queue
│   ├── sync.js             Pushes the queue to Supabase on reconnect
│   ├── supabase.js         Supabase client + signed photo URLs
│   ├── validation.js       Pure form-validation logic (unit tested)
│   ├── format.js           Small display-formatting helpers
│   ├── confirmDialog.js    Promise-based confirm/cancel modal
│   ├── views/              One file per screen (see table above)
│   └── style.css
├── tests/                  Vitest specs, mirroring src/
├── migrations/             SQL actually run against the live database, in order
├── schema.sql              Full current schema (source of truth, manually applied)
├── .github/workflows/      CI (lint + test on PRs) and GitHub Pages deploy
└── CLAUDE.md               Project conventions/instructions for AI-assisted development
```

## Getting started

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

Other scripts: `npm run build`, `npm test`, `npm run test:watch`, `npm run lint`.

## Deployment

Every merge to `main` runs the CI checks and then deploys straight to
GitHub Pages (`.github/workflows/deploy.yml`) — no manual release step.
