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
1. **Login** — email/password (see "Authentication"). A brand-new signup also collects first/last name. **Forgot password?** leads to a self-service reset (see "Password reset").
2. **Name prompt, if needed** — an account that reaches this point with no name on file (a pre-existing account, or a future non-form sign-in path) is blocked here until it provides one. See "Routing and auth/profile gates".
3. **Assets** (`#/register`) — the landing screen after login. Search/browse/sort the register, or start a new asset.
4. **New asset** (`#/capture`) — photo + details, with any repairs already known about it.
5. **Asset detail** (`#/asset/:id`) — view/edit an asset, and its full repair log: add a repair, edit it, mark it complete, and discuss it in a per-repair comment thread. **Deleting an asset happens here and nowhere else.**

There is no separate "Home" screen — `#/register` is where every login lands.

**The register is read-only** — it browses and navigates, it doesn't mutate. It briefly carried a per-row delete button, which turned out to be unusable on the device this app is actually for: it revealed only on `:hover`/`:focus-within`, and touch has no hover (with `pointer-events: none` until then, it couldn't even be tapped into existence). The desktop table layout never had one at all, so deleting was already effectively a detail-page action. Putting a destructive control one stray tap from a scanning list was also the wrong shape for a field device — the detail page makes it a deliberate step, and gives it room to name what's being destroyed ("…and its 2 repair records"). Don't reintroduce one without revisiting that.

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
│   ├── auth.js              Login/signup/session, plus profile-completeness helpers (getProfile, isProfileComplete, submitProfileName) and the cached/persisted profile name (getCachedProfileName)
│   ├── camera.js            Storage-path naming + the downscale/re-compress applied to every photo before it's queued
│   ├── db.js                IndexedDB offline queue
│   ├── sync.js              Pushes the queue to Supabase on reconnect
│   ├── supabase.js          Supabase client init + signed photo URLs
│   ├── validation.js        Pure, unit-tested form-validation logic
│   ├── format.js            Small display-formatting helpers (the "Item-01" asset ID, condition labels/rank, profile initials + display-name fallback)
│   ├── confirmDialog.js     Promise-based confirm/cancel modal (see "View pattern" below)
│   ├── profileMenu.js       Persistent profile icon + popover (name, and the app's only Log out) — see "Persistent chrome" below
│   ├── lightbox.js          Full-screen photo viewer (see "Overlays and stacking order")
│   ├── assets/              Logo + font, imported from JS/CSS (not referenced from public/) so Vite base-prefixes them correctly under GitHub Pages' subpath
│   ├── views/
│   │   ├── login.js           Login, and signup (first name, last name, email, password, in that order)
│   │   ├── forgotPassword.js  Request a password reset email
│   │   ├── resetPassword.js   Set a new password from the emailed recovery link
│   │   ├── completeProfile.js Blocking post-login name prompt for an account with no name on file
│   │   ├── register.js        Search/browse/sort the asset register (read-only — deleting lives on the asset's own page)
│   │   ├── capture.js         New asset form + photo capture (up to four, see "Camera capture")
│   │   └── detail.js          View/edit an asset; the repair + comment workflow
│   └── style.css
├── tests/                  Vitest specs — one file per src module under test
├── e2e/                    Playwright specs — one file per user-facing flow, see "Testing conventions"
│   ├── auth.setup.js         Logs in once, saves storageState for every other spec to reuse
│   ├── supabase-helper.js    Node-side Supabase client for asserting/cleaning up server-side state
│   └── fixtures/             Files specs hand to setInputFiles() etc.
├── migrations/             Incremental SQL actually run against the live Supabase project, in the order it was run
├── schema.sql              Full current schema — see "Data model" for how this relates to migrations/
├── .github/
│   └── workflows/
│       ├── ci.yml            Lint + Vitest, and the Playwright e2e suite, on every PR
│       └── deploy.yml        Build + deploy to GitHub Pages on every push to main
├── playwright.config.js
├── vite.config.js
├── .gitattributes
├── .env                    Supabase URL + publishable key (gitignored)
├── .env.e2e                Same, for the separate e2e Supabase project, plus test-account credentials (gitignored)
├── package.json
├── README.md               Project overview for a human reader (features, setup) — CLAUDE.md covers conventions instead
└── CLAUDE.md
```

### View pattern
There's no component framework, so every view follows the same shape: a function `(container, { navigate, params }) => void` that renders its own HTML into `container` via a template string, then wires up event listeners by querying the DOM it just wrote. A view whose state changes after user interaction (opening an edit form, expanding a repair's comment thread, etc.) doesn't patch the DOM — it re-runs its own `drawView()`-style function, which re-renders the whole template from current state and re-wires everything from scratch. This is simple at the cost of being coarse-grained; it's a deliberate trade-off for an app this size, not an oversight.

`confirmDialog({ message })` is the one shared UI primitive outside this pattern: it builds its own backdrop/modal, appends it to `document.body` directly (not into a view's `container`), and returns a Promise that resolves `true` on confirm or `false` on cancel/backdrop-click/Escape. Views awaiting it don't need to render or tear down anything themselves.

### Overlays and stacking order
Two shared overlays append themselves to `document.body` rather than rendering into a view — `confirmDialog.js` and `lightbox.js` (the full-screen photo viewer). The order between them and the chrome is **set explicitly in `style.css`, not left to DOM order**:

| Layer | `z-index` | Why |
| --- | --- | --- |
| `confirmDialog`'s `.modal-backdrop` | 100 | Always on top — a confirmation asked for *from* an overlay has to appear above it |
| `lightbox`'s `.lightbox-backdrop` | 98 | Above the chrome, so a photo isn't overlapped by the profile avatar |
| `.app-chrome` (profile menu) | 95 | A stacking context, so its popover can't escape above either overlay |
| `.repair-info-panel` (phone bottom sheet) | 90 | |

Changing any of these means checking the others; `lightbox.spec.js` asserts the ordering by comparing computed `z-index` rather than trusting appearance.

**The lightbox is deliberately not a history entry.** Back-button-closes-the-overlay is a nice touch, but this app routes on `window.location.hash`, and pushing overlay state into history means the router has to tell "the user navigated" apart from "the user shut a picture" — real confusion for a modest gain.

**Freezing the page behind it pins the body, rather than hiding its overflow.** `overflow: hidden` was the first attempt and is not reliable here: once the viewport has no scrollable overflow the browser resets the position, measured jumping straight to the top, so the user lost their place on reopening the viewer. The body is instead taken out of flow at a negative offset (`position: fixed; top: -<scrollY>px`), which renders identically, is genuinely unscrollable, and leaves the offset something the code owns and restores exactly. Two details keep it working: reading a layout property after restoring the styles (otherwise the document is still the height of a fixed body, and the scroll is clamped straight back to zero), and `focus({ preventScroll: true })` in both directions — focusing into a `position: fixed` overlay still scrolls the *document* behind it.

### Persistent chrome
`index.html` has a second top-level element beside `#app`: `<header id="app-chrome">`, which `main.js` mounts `profileMenu.js` into **once**, at startup. `route()` then only ever calls the updater it returns — it never re-creates it. The popover shows the signed-in user's name (read-only — there's no edit affordance) and holds **the app's only Log out button**; it used to sit in `register.js`'s own `.view-header`, where it wasn't reachable from the capture or detail screens at all.

**Anything persistent across views has to live here, not inside a view.** The view pattern above rewrites a view's whole container on every re-render, so UI rendered inside one is destroyed and rebuilt whenever that view redraws (opening an edit form, expanding a comment thread). For the profile menu that would mean an open popover vanishing mid-interaction and focus being lost; it would also make every new view a fresh chance to forget to include it. Add to the chrome element instead — and keep it out of `src/views/`, which is for routes.

Two things about it are load-bearing and easy to undo by accident:
- **`.app-chrome` is `position: sticky`, not static.** In plain flow the bar scrolls away with the page, which leaves the icon unreachable on a long register — and makes the browser scroll the user back to the top just to click it (caught by the e2e spec, which scrolls before asserting). Sticky keeps it in flow, so it reserves its own space and can't overlap a view's own `.view-header` (which already puts controls top-right in the same column), while staying pinned in view.
- **Its `z-index: 95` makes it a stacking context**, deliberately between the repair info panel's phone-width bottom sheet (90) and `confirmDialog`'s backdrop (100). The popover inside therefore cannot outrank a modal whatever it sets. `confirmDialog` also dispatches an `app:modal-open` event as it opens, which the profile menu listens for and closes on — it announces rather than reaching into the menu directly, so shared UI stays unaware of whatever chrome surrounds it.

The name comes from the profile cache in `auth.js` (`getCachedProfileName`), never a fresh query. That cache is also persisted to `localStorage`, keyed by user id, so an offline reload still shows a name — the profile query is exactly what can't succeed then. `localStorage` rather than `db.js`: those helpers are all shaped around the offline *sync queue* (`queueX`/`getUnsyncedX`/`markXSynced`), and a cached display name is a read-through cache, not a queued mutation. It's cleared on `signOut()` only — deliberately not in `resetProfileCache()`, which also runs on sign-in, where a restore-`SIGNED_IN` on an ordinary offline reload would otherwise wipe the very thing it exists to preserve.

`validation.js` holds every form's validation as a pure function (`validateAssetForm`, `validateRepairForm`, `validateNameForm`, `validatePassword`, `validatePasswordResetForm`) — no DOM, no Supabase — so it can be unit tested directly and reused wherever the same rules apply twice. `validateNameForm` is shared between the signup form and the post-login name prompt; `validatePassword` is shared between signup and the password-reset screen, for the same reason — the reset screen must never accept a password signup would have rejected.

## Routing and auth/profile gates
`main.js` has no router library: it matches `window.location.hash` against a small ordered list of `{ pattern (RegExp), view }` entries and calls the matching view function. `navigate(hash)` either re-runs the current route directly (if the hash isn't changing, so a click back to the current screen still refreshes it) or sets `window.location.hash`, which fires the `hashchange` listener that calls `route()`.

Before any route renders, `route()` runs through gates in this order:
1. **No session, and the hash isn't in `PUBLIC_HASHES`** (`#/login`, `#/forgot-password`, `#/reset-password`) → redirect to `#/login`.
2. **Session exists, and the hash is `#/login`** → redirect to `#/register` (the default landing screen).
3. **Stale `#/home` bookmarks/history** → redirected to `#/register`; the Home screen doesn't exist.
4. **Session exists, the hash isn't `#/complete-profile` or `#/reset-password`, and the account's profile is incomplete** (`isProfileComplete()` in `auth.js`) → redirect to `#/complete-profile`, blocking every other route until it's satisfied.
5. **Session exists, the hash *is* `#/complete-profile`, but the profile is already complete** → redirect to `#/register` (covers a stale bookmark or the back button after already completing it).

Gate 4 is the one most likely to trip up a future change, so a few things worth knowing about it:
- The completeness check is **cached per session** (`profileCompleteCache` in `auth.js`), not re-queried on every hash change. The cache resets whenever a genuine sign-in/sign-out transition happens, and is set directly to "complete" the moment `completeProfile.js` successfully calls `submitProfileName()` (`markProfileComplete()`), rather than waiting on a fresh query that would just re-confirm what the view already knows.
- It **deliberately fails open, on a bound**: if the profile query itself errors — a network blip, or this migration not yet having been applied — `isProfileComplete()` returns `true` rather than blocking the whole app. Offline, a fetch doesn't always fail cleanly and quickly; it can hang with no response at all rather than rejecting, so the query is wrapped in a 5-second timeout (`PROFILE_CHECK_TIMEOUT_MS`) — without it, `route()` itself would hang forever awaiting a promise that never settles either way. This is an onboarding nicety, not access control, and the app's whole premise is field reliability; a broken (or slow) query here should never be the thing that locks a field worker out of logging an asset. The fail-open result is cached the same as a real success — otherwise every single hash change while offline would re-pay the full timeout, stacking into a real, user-visible stall on each navigation.
- `#/reset-password` is exempt from gate 4 for a sharper reason than convenience: **clicking a password recovery link establishes a session** (see "Password reset"). Without this exemption, an account with no name on file would get that fresh recovery session hijacked straight to `#/complete-profile` before ever reaching the password form — the reset would silently fail to do the one thing the user clicked the link for.

`onAuthChange` (`auth.js`) passes Supabase's event type through to its callback, not just the session, and `main.js` only treats `SIGNED_IN`/`SIGNED_OUT`/`PASSWORD_RECOVERY` as reasons to reset the profile cache and re-render (`AUTH_TRANSITION_EVENTS`). Supabase also fires this listener for `INITIAL_SESSION` (every page load — redundant with the explicit `route()` call already handling first paint) and `TOKEN_REFRESHED` (periodic, in the background, nothing the user did actually changed); treating those the same as a real transition used to mean 2-3x the queries and re-renders for a single sign-in.

`SIGNED_IN` itself isn't a reliable "this is a genuine new sign-in" signal either: Supabase can also fire it while restoring a pre-existing session from storage on page load, not just on an interactive sign-in (undocumented, but observed directly — an e2e spec lost text it had just typed into a form, because this listener tore the view down again moments after first paint). `route()` sets a module-level `sessionCheckedOnce` flag the first time its own session check resolves; the listener ignores any transition event that arrives before that flag is set, since it's necessarily startup noise the explicit first-paint `route()` call is already handling, not a later, genuine transition.

**`route()` calls can overlap, and an older one must never render.** It reads the hash once on entry and then awaits — the session lookup, and the profile query behind gate 4 — so a call parked on one of those is still holding the hash it started with. Nothing serialises them either: signing in fires a `navigate()` *and* a `SIGNED_IN` event, so two or three can be in flight at once, each holding a different hash, finishing in whatever order the profile cache and the network leave them in. The last to finish would win regardless of which is current, rendering the old view over whatever the user had since navigated to (and updating the chrome for a screen they're no longer on). `route()` therefore bumps a module-level `routeGeneration` on entry and bails after every await once a newer call has started — see the `isSuperseded()` checks. Any new `await` added to `route()` needs one after it. `auth-gates.spec.js`'s "an older route does not render over a newer one" forces the ordering deliberately (first profile query slow, second fast) and fails without the guard.

**Don't navigate manually straight after a session change.** The auth listener above is what owns that: it sets `currentSession` and re-runs `route()`. Logging out used to `navigate('#/login')` itself, which raced the listener — `route()` caches the session and only re-reads it when falsy, so it could run with the *old* session still cached, and gate 2 ("session, and the hash is `#/login`") would bounce the user to `#/register` looking signed in while actually signed out. That the cache self-heals in the other direction — null refreshes, stale doesn't — is why signing in never showed the same symptom. `profileMenu.js`'s logout now just calls `signOut()` and lets `SIGNED_OUT` drive the routing.

## Data model (Supabase / Postgres)
`schema.sql` is the full current schema and the thing to read for exact column lists — this section covers the shape and the reasoning, not a column-by-column copy that will only go stale again.

**`migrations/` vs `schema.sql`**: `migrations/` holds the incremental SQL that was actually run against the live Supabase project, numbered in the order it was run (`0001_...`, `0002_...`, ...). `schema.sql` is the full current picture, kept in sync by hand whenever a migration lands. Neither is auto-applied anywhere — there's no migration runner. When a change needs to reach the live database, write the migration file, run it directly in the Supabase SQL editor, and fold the same change into `schema.sql`.

### Tables
- **`assets`** — one row per logged asset: name, description, photo path, recorded date/time, plus `created_by`/`created_at`/`updated_at`. `asset_number` is a sequence-backed `generated always as identity` column, formatted client-side into the user-facing "Item-01" ID (`format.js`) — assigned atomically at insert time and never reused, even after a delete. `condition` (`'good'`/`'ok'`/`'poor'`, check-constrained) and `condition_note` (free text, length-capped at 200 to match `validation.js`'s `CONDITION_NOTE_MAX_LENGTH`) are both nullable and optional at capture — every pre-existing asset has neither, there's no sensible value to backfill, and a required field would be one more thing standing between field staff and a saved record. **Current state only, not a history**: editing overwrites the previous value, the same trade-off `asset_repairs` would face if it were a single flag instead of a log — if condition history ever matters, that's the pattern to follow (an `asset_conditions` table, current value read from the latest row), not a retrofit of this column. Stored lowercase; display casing and the best-to-worst sort rank both live in `format.js` (`formatCondition`, `conditionRank`) as the single source of truth, so a sort can never silently regress to alphabetical order if a fourth value is ever added.
- **`asset_repairs`** — a repair log per asset, not a single flag: an asset can have several repair records over its life, each independently editable and markable complete. `on delete cascade` on `asset_id` so deleting an asset atomically removes its repair history at the DB level. `created_by_email`/`updated_by_email`/`completed_by_email` are snapshotted at each of those actions — `auth.users` isn't queryable client-side under RLS, so the email is captured directly rather than joined later.
- **`repair_comments`** — a comment thread per repair (oldest first), not a single field: the optional comment on marking a repair complete is just that thread's first entry, not a separate column. `created_by_email` and `created_by_name` are both snapshotted at comment-creation time for the same reason as above — there's no client-side access to look up *another* user's name after the fact, only your own. `created_by_name` is null for a comment left by an account with no name on file yet; the UI falls back to `created_by_email` in that case.
- **`profiles`** — one row per `auth.users` account: `first_name`, `last_name`, both nullable. Nullable is deliberate — mandatory-ness for a *new* signup is an application-layer rule (the signup form, re-enforced by the CHECK constraints below), not a database one, because every pre-existing account starts with no name on file by design, not by error. A partial index (`profiles_missing_name_idx`, `where first_name is null or last_name is null`) supports counting how many accounts still need the post-login prompt.
- **`asset_photos`** — up to four photos per asset, in place of the single `assets.photo_path`. `position` is a **sort key, not a count**: removing a photo leaves a gap rather than renumbering the rows that didn't change, because renumbering means extra writes and, offline, two devices renumbering the same set differently. New photos take `max(position) + 1`. The four-photo ceiling is enforced client-side only (`photoLimitReached` in `validation.js`) — under the shared "any logged-in user can edit everything" policy two people can each pass that check and produce a fifth row, the same class of problem as the last-write-wins limitation below, so the reading side tolerates it rather than the database forbidding it.
- **Adding a photo works offline; removing a *synced* one does not.** The asymmetry looks inconsistent until you see the reasoning. Adding is the same act as capturing — someone standing in front of the asset with no signal — so it queues like any other create. Removing a photo that never synced is purely local: no row, no Storage object, just dropping it out of the queue. Removing one that *has* synced means deleting a database row **and** a Storage object, and this app has no mechanism for queueing that reliably — asset deletion is a direct call too, so this keeps **one deletion story rather than two**. It checks `navigator.onLine` and says so plainly ("You need to be online to delete this photo."), the way the password-reset screens do, rather than appearing to succeed.
- **Delete the row first, then the Storage object.** The other order leaves a thumbnail pointing at a file that no longer exists — a visible, confusing bug on the detail screen — if the second step fails. This order leaves an orphaned file instead: invisible, harmless short-term, cleanable later.
- **Known limitation: orphaned Storage objects accumulate.** From partial failures above, and from `on delete cascade` dropping `asset_photos` rows when an asset is deleted without touching the files behind them. Same spirit as the last-write-wins note below — worth a periodic cleanup job eventually, not worth solving inline.
- **Removing a photo repoints `assets.photo_path`** at whatever is left (or null). It's only there for pre-multi-photo clients, but left stale it would be a *broken* image for them rather than simply no image.
- **Reading photos on the detail screen**: `detail.js` resolves them **once per asset view, not per render** — `drawView()` re-runs on every interaction, and re-signing four URLs each time would be a round trip for nothing. Signed URLs are fetched in one batch (`getPhotoUrls`), and queued-but-unsynced photos are shown from their **local blob** instead, since there's no object in Storage to sign yet; an asset captured offline still shows its photos. A photo that has just synced briefly exists in both (the row is written before the queue entry is dropped), so the saved copy wins on id and it isn't shown twice. A path that can't be signed is dropped rather than rendered as a broken image. **A failed reload keeps the last known saved photos rather than clearing them** — adding a photo offline re-runs this resolve, and with no connection the synced ones can neither be listed nor re-signed, so clearing would make photos already on screen vanish as a side effect of adding another. The signed URLs in hand stay valid for the hour they were issued for. The timeout fallback is therefore `null` (the marker for "didn't answer"), kept distinct from a query that genuinely returned no rows — which does mean the asset has no photos.
- **`assets.photo_path` is superseded but still written.** It holds the first photo's path, purely so clients running the pre-multi-photo version keep showing an image — the app shell is service-worker cached, so those persist for a while after a deploy, and they read this column knowing nothing of `asset_photos`. Dropping the column (and this dual-write) is a follow-up issue, once clients have had time to update.
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

### Password reset
Self-service, via `supabase.auth.resetPasswordForEmail()` → an emailed link → `supabase.auth.updateUser({ password })`. No custom token handling — the entire mechanism is Supabase's.

The one real complexity is that **this app routes on `window.location.hash`, and Supabase's default implicit auth flow returns its tokens in the URL fragment** — which collides directly with the hash router (the emailed link would arrive as `#access_token=...&type=recovery` where the router expects `#/reset-password`). Supabase's own docs call out hash-based routers as unsupported for exactly this reason. The fix is `supabase.js`'s `flowType: 'pkce'`: PKCE returns the auth code as a **query parameter** instead, so a `redirectTo` of `.../#/reset-password` comes back as `.../?code=xxx#/reset-password`, leaving the hash route intact. With `detectSessionInUrl` at its default, the client exchanges the code for a session automatically on load — no app code has to touch the code/token itself.

**`flowType` is client-wide** — it governs every auth flow, not just password reset, including the signup confirmation email. Re-test signup end-to-end after touching it, not just the reset path.

- `forgotPassword.js` (`#/forgot-password`) — a single email field. Calls `requestPasswordReset()` (`auth.js`), which sets `redirectTo` to `${window.location.origin}${import.meta.env.BASE_URL}#/reset-password`. Shows the **same neutral confirmation regardless of whether the address has an account** ("If that email has an account, a reset link is on its way.") — Supabase's API itself doesn't reveal account existence, and the UI must not undo that by branching on it.
- `resetPassword.js` (`#/reset-password`) — new password + confirm password, validated by the shared `validatePasswordResetForm`, then `updatePassword()` (`auth.js`). On success the user already has a valid session, so it navigates straight to `#/register` like a normal login.
- **Expired/already-used link**: the recovery code is short-lived and single-use, so this is a normal thing that will happen, not an edge case to skip. `resetPassword.js` checks for a session on load (see the routing note above) — no session means the code exchange never succeeded, so it shows a plain-English "this link has expired" message with a link back to `#/forgot-password`, rather than a raw Supabase error or a bounce to `#/login`.
- **Offline**: a password reset needs a live round trip — there's no meaningful "sync later" for it, and it deliberately does **not** go through the `db.js` offline queue. Both views check `navigator.onLine` at submit time and say so plainly ("You need to be online to reset your password.") rather than appearing to succeed or failing with a generic network error.

**Supabase dashboard configuration (outside the codebase, one-time)** — the flow fails with a redirect error that looks like a code bug if this isn't done:
- Add the production redirect URL (`https://benobrett.github.io/asset-register/#/reset-password`) to **Authentication → URL Configuration → Redirect URLs**, plus a localhost equivalent for local development.
- Confirm the **Site URL** is correct for the GitHub Pages subpath.
- Check the password recovery email template renders sensibly.
- The built-in email service is rate-limited and meant for testing (a handful of messages per hour) — likely fine for a small team, but the first thing to check if resets ever fail silently in real use. Custom SMTP is the fix, and is out of scope for this feature.

**Future: Google sign-in.** Still on the roadmap, not yet implemented — there's no `signInWithOAuth` call anywhere in the codebase today. When it's added, the `profiles` trigger already covers it with no changes needed: an OAuth sign-in creates an `auth.users` row with no `first_name`/`last_name` metadata, so it lands with a null-named `profiles` row and goes through the same post-login prompt as a legacy account. What's left is only the provider swap (`supabase.auth.signInWithOAuth({ provider: 'google' })`) and a one-time setup step outside the codebase: enabling the Google provider in the Supabase dashboard and registering OAuth credentials in Google Cloud Console. If this is ever restricted to one organization's staff, Google's `hd` parameter can lock sign-in to a specific Workspace domain.

## Offline strategy
1. A session is required to log in at least once while online; Supabase's client SDK caches that session locally, so the app stays "logged in" offline afterward.
2. Every save writes to IndexedDB first (`db.js`), tagged `synced: false`, using a client-generated UUID as the record's `id` — the same UUID Supabase will store, so there's no ID-reconciliation step later: the client already knows the id the row will have before it's ever synced.
3. `db.js` follows one naming pattern per queued entity — `queue<Entity>`, `getUnsynced<Entity>s`, `mark<Entity>Synced` (e.g. `queueAsset`/`getUnsyncedAssets`/`markAssetSynced`) — currently for assets, photos, repairs, and repair comments. Follow the same shape for any future queued entity. Photos are their **own store**, not an array inside the queued asset, because they also have to be addable to an asset that synced long ago — something a field nested in the asset record couldn't represent.
4. If online, `sync.js`'s `syncAll()` runs immediately after queuing: **assets, then photos, then repairs, then repair comments**, in that order — each step references a row an earlier one created as a foreign key, so syncing out of order would fail. Photos sit directly after assets because that's the only thing they depend on. Each photo uploads to Storage first and only then inserts its `asset_photos` row: the other order would briefly leave a row pointing at an object that isn't there, which renders as a broken image. Mark `synced: true` (by removing the record from its queue store) on success.
   - **A legacy queued asset carries its own photo blob** (`asset.photo`/`asset.photoPath`) rather than separate photo records. `syncQueuedAssets` still handles that shape, and gives it an `asset_photos` row too — otherwise the photo would reach Storage with nothing pointing at it and silently vanish from the app. Covered by a Vitest case; don't remove it until the queue can no longer contain pre-multi-photo records.
5. If offline, the record sits in the queue. A listener on `window.addEventListener('online', ...)`, plus a check on app load, retries anything still unsynced.
6. IndexedDB stores Blobs directly, so the photo itself — not just its metadata — survives offline until it syncs. **Every photo is downscaled before it's queued** (`downscaleImage` in `camera.js`: 1600px longest edge, JPEG 0.8). Four full-size tablet photos per asset is 20–30MB sitting in IndexedDB until there's a connection, which threatens the browser's storage quota and makes the eventual upload punishing on a field connection. Done once at capture rather than at upload, so the *queue* stays small rather than just the request that drains it. EXIF orientation is applied during the resize (`imageOrientation: 'from-image'`), since drawing to a canvas otherwise discards it and portrait photos come out rotated.
7. Per-record sync failures are caught and left queued rather than thrown — a dropped connection mid-sync is an expected condition here, not a bug. `vite-plugin-pwa` separately caches the app shell (HTML/CSS/JS) so the app loads at all with no connection.
8. **Known limitation:** if the same asset is edited offline in one session while also edited online elsewhere before the first sync completes, whichever sync lands last wins silently — there's no conflict detection. Not a practical risk with a single user; worth addressing (e.g. comparing `updated_at` before overwriting, or flagging the conflict for manual review) if this becomes genuinely multi-user.
9. **The register view (`register.js`) merges the queue into its display, rather than only ever showing what's already synced.** It fetches `getUnsyncedAssets()` alongside its live Supabase query and shows anything still queued as a non-interactive, visually distinct row ("Not yet synced" / "⏳ Syncing…" — no `asset_number` exists pre-sync, and there's nowhere to navigate or delete yet). This covers two windows: briefly online between queuing and `sync.js` actually uploading, and genuinely offline, where the live query fails outright and the view falls back to *only* this device's queued assets (with a `.form-notice`, not an error banner, explaining the register is partial until reconnected). Search filters queued items client-side (`matchesSearch`), since they never go through the server-side `ilike` query; a repairs-only sort excludes them outright (a just-created asset has no repairs yet). Like the profile check above, both the live query and the repairs query are wrapped in a bounded timeout (`QUERY_TIMEOUT_MS`, 3s) for the same reason — an offline fetch that hangs instead of rejecting would otherwise leave the view stuck on "Loading…" forever instead of ever reaching this fallback.

Not everything goes through this queue: password reset (see "Password reset") needs a live round trip and is deliberately excluded — there's no meaningful way to queue "email a recovery link" for later.

## Camera capture
Using `<input type="file" accept="image/*" capture="environment">` rather than a hand-built `getUserMedia()` live preview:
- Delegates to the Chromebook's native camera app — better focus/exposure than a custom capture, for free.
- Far less code, far fewer device-specific edge cases (stream permissions, cleanup, orientation) to debug.
- Returns a `File` either way — the offline queue doesn't care which method produced it.
- Trade-off: briefly leaves the app for the OS camera UI instead of a live in-app preview. If that friction matters once this is in real use, `getUserMedia()` is a reasonable v2 — a swap-in replacement, nothing downstream needs to change.
- Confirm the specific Chromebook tablet model has a usable rear camera — some cheaper ones only have a front-facing one meant for video calls.

**Up to four photos, accumulated one at a time.** `capture="environment"` hands off to the device camera and returns a single image, and the `multiple` attribute is generally ignored while `capture` is set — so the flow is "Add photo" → camera → returns → repeat, each result appended to a list. Two things about the capture form are load-bearing and easy to undo:
- **The input's `value` is cleared immediately after each capture**, before any `await`. Without it, choosing the same file twice in a row fires no `change` event at all and the second photo vanishes with no error to explain it.
- **The input is hidden and opened by a button.** It has to be re-triggered once per photo, and a bare file input gives no room for a tap target sized for a tablet or for a label that changes with the count. The button disables at four with an explanation rather than going quiet when tapped.

**On a saved asset (`detail.js`), the same photos are behind an "Edit photos" toggle.** Viewing is the default and is a safe mode: a thumbnail's only action is opening the lightbox. Remove controls and the Add photo button appear only once edit mode is on, and the thumbnails are `disabled` while it is — otherwise the tile carries two competing actions in the same tap target, and on a touch device the expensive one wins by accident. Capture (`capture.js`) has no such toggle: nothing there is destructive yet, since a photo removed before saving was never anything but local.

Thumbnails are a **fixed-size** grid with `object-fit: cover`, so a portrait and a landscape photo occupy identical tiles and the grid never reflows as photos arrive. Sized generously (`8.5rem`) — these are read at arm's length by staff who won't thank us for desktop-sized thumbnails. Each photo's Remove control sits *below* its tile with its own full-width hit area, not as a badge floating over a corner of the image: that's the easy thing to mis-tap on a touchscreen, and mis-tapping this one costs a walk back to the asset to re-photograph it. Removal goes through `confirmDialog` for the same reason.

## Environment variables
`.env` (gitignored) holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Vite exposes these to client code via `import.meta.env`. `.env.example` documents both names with empty values — copy it to `.env` and fill them in.

`.env.e2e` (gitignored) is the same two keys plus `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` and `E2E_INCOMPLETE_PROFILE_EMAIL`/`E2E_INCOMPLETE_PROFILE_PASSWORD`, pointed at a **separate** Supabase project — see "Testing conventions" for why this can't just reuse `.env`. `.env.e2e.example` documents it the same way.

## Testing conventions
**Vitest** (`tests/`) covers pure logic — validation, formatting, the offline queue. **Playwright** (`e2e/`) covers user-facing flows end to end in a real (Chromium) browser. Any PR that adds or changes a user-facing flow includes or updates an e2e spec; a bug fix to an existing flow should add the spec that would have caught the bug. Pure-logic changes need Vitest only.

### Vitest
- Unit tests in `tests/` — one file per `src` module under test (`auth.test.js`, `db.test.js`, `format.test.js`, `sync.test.js`, `validation.test.js`).
- Test pure logic: form validation (`validation.js`), the offline queue and its sync (`db.js`/`sync.js`, mocking the Supabase client), the profile-completeness cache and its fail-open behavior (`auth.js`). Don't unit test camera hardware, real network calls, the OAuth redirect, or the password-reset email/redirect round trip — verify those manually, or cover them in Playwright.
- IndexedDB isn't available outside a browser — `fake-indexeddb` is already in use to test `db.js`/`sync.js` under Vitest.
- `vite.config.js`'s `test.exclude` keeps Vitest out of `e2e/` — without it, Vitest's default glob also matches Playwright's `*.spec.js` files and fails trying to run them as unit tests.
- Run `npm test` and `npm run lint` before opening a PR.

### Playwright (e2e)
- Specs live in `e2e/`, one flow per file, named after the flow. Run with `npm run test:e2e` (`npm run test:e2e:ui` for the debugging UI).
- **Runs against the production bundle**, not the dev server: `playwright.config.js`'s `webServer` runs `npm run build:e2e && npm run preview`. This matters because `vite-plugin-pwa`'s service worker behaves differently in a dev build, and the production bundle is what actually ships.
- **A separate Supabase project from `.env`**, via `.env.e2e` (`npm run build:e2e` is `vite build --mode e2e`, which loads it). Specs create real assets/repairs/comments, and this app's RLS makes every one of those visible to every logged-in user — pointed at production, a test run would steadily fill the real register with junk that field staff then see. In CI there's no `.env.e2e` file at all; the same variable names are injected directly as job env from repository secrets (`E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, `E2E_INCOMPLETE_PROFILE_EMAIL`, `E2E_INCOMPLETE_PROFILE_PASSWORD`), which Vite picks up the same way regardless of mode.
- **A second dedicated account, `E2E_INCOMPLETE_PROFILE_EMAIL`/`PASSWORD`**, deliberately left with no name on file (created the same way as the main test account — see `migrations/e2e-seed-test-user.sql` — but never seeded). `auth-gates.spec.js` uses it to test the `#/complete-profile` gate: the main test account always has a name, and `profiles`' RLS forbids ever resetting one once set, so that scenario can't be produced from a fresh `signUp()` call either — the e2e project requires email confirmation, so a freshly-signed-up account has no session to test with until confirmed. **Never submit the complete-profile form for this account in any spec** — doing so sets its name permanently, via a change no client-side call can undo.
- **Auth is done once, not per spec**: a `setup` project (`e2e/auth.setup.js`) logs in and saves `storageState` to `e2e/.auth/user.json` (gitignored); the `chromium` project depends on it and reuses that state. `login.spec.js` is the one place that needs to start logged out, so it overrides `storageState` back to empty per-test.
- **Locate by role, label, and visible text — never CSS classes.** Views here re-render by rewriting their own HTML from scratch (see "View pattern"), so a class-based selector breaks on unrelated refactors that don't change what the user actually sees. This is the main source of flakiness to design against.
- **No fixed `waitForTimeout` sleeps.** Rely on Playwright's auto-waiting and `expect.poll()` (used to wait for a record to reach Supabase after reconnecting) instead — a fixed sleep in an offline-sync app is either too short and flaky or too long and slow.
- Each spec either uses a uniquely-named record (a timestamp in the name) so parallel/repeated runs don't collide, or cleans up what it created (usually both) — via a direct, Node-side Supabase client (`e2e/supabase-helper.js`, signed in as the test account) rather than the browser under test, so cleanup doesn't depend on the UI having worked.
- **Limitations — a passing suite is necessary, not sufficient:**
  - **The camera itself isn't exercised.** `setInputFiles()` supplies a file directly to the input; it doesn't drive the native camera app or verify `capture="environment"` behavior. Periodic manual checks on the real Chromebook tablet are still required.
  - **Service worker / app-shell caching isn't faithfully simulated.** Playwright's offline mode blocks network requests at the browser-context level; it isn't the same as a device genuinely losing signal with a warm PWA cache already installed.
  - **Supabase itself is not under test** — only this app's use of it.

## Git workflow & CI/CD
- `main` is protected: no direct pushes, PRs only.
- Branch protection requires a passing CI check before merge. (A required approving review is worth adding once there's more than one contributor — with a single person, GitHub won't let you approve your own PR, so that specific rule would block every merge until then.)
- One branch per change: `feature/short-description`, `fix/short-description`, or `docs/short-description`.
- `.github/workflows/ci.yml` runs on every PR — a `test` job (lint + Vitest) and an `e2e` job (Playwright), in parallel:
```yaml
name: CI
on: pull_request
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run lint
      - run: npm test

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # 22, not 20 - e2e/supabase-helper.js's Node-side Supabase client
      # needs a native WebSocket (its realtime dependency), which only
      # Node 22+ provides. Kept the same across both jobs in this file
      # rather than mixing versions.
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - name: Cache Playwright browsers
        id: playwright-cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-chromium-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - name: Install Chromium (with system deps)
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium
      - name: Install Chromium's system deps only (cache hit)
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium
      - name: Run Playwright e2e suite
        run: npm run test:e2e
        env:
          VITE_SUPABASE_URL: ${{ secrets.E2E_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.E2E_SUPABASE_PUBLISHABLE_KEY }}
          E2E_TEST_EMAIL: ${{ secrets.E2E_TEST_EMAIL }}
          E2E_TEST_PASSWORD: ${{ secrets.E2E_TEST_PASSWORD }}
          E2E_INCOMPLETE_PROFILE_EMAIL: ${{ secrets.E2E_INCOMPLETE_PROFILE_EMAIL }}
          E2E_INCOMPLETE_PROFILE_PASSWORD: ${{ secrets.E2E_INCOMPLETE_PROFILE_PASSWORD }}
      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```
The browser binary is cached by `package-lock.json`'s hash (bumps whenever `@playwright/test`'s version changes); a cache hit still needs `install-deps` since the cached path doesn't include the OS-level packages Chromium needs, but skips the ~100MB+ browser download. Retries (`playwright.config.js`: 2 on CI, 0 locally) and the failure-only report upload are what make a CI-only flake debuggable without blocking every merge on it.
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

### Automated code review
`.github/workflows/claude-review.yml` — separate from `ci.yml` so a review failure or API outage can never affect the lint/test signal — runs an AI code review on every PR via `anthropics/claude-code-action@v1` and the official `code-review` plugin:
```yaml
name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize]
    paths-ignore:
      - '**.md'
      - 'docs/**'

permissions:
  contents: read
  pull-requests: write
  id-token: write

concurrency:
  group: claude-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Claude code review
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          plugin_marketplaces: "https://github.com/anthropics/claude-code.git"
          plugins: "code-review@claude-code-plugins"
          prompt: "/code-review:code-review ${{ github.repository }}/pull/${{ github.event.pull_request.number }} --comment"
          claude_args: |
            --max-turns 30
            --allowedTools "Bash(gh issue view:*),Bash(gh search:*),Bash(gh issue list:*),Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*),Bash(gh pr list:*),mcp__github_inline_comment__create_inline_comment"
```
- **Never a required check.** Branch protection only requires `ci.yml`'s `test`/`e2e` jobs, and this workflow isn't added to that list. A required check has to be objective and deterministic; an AI reviewer's output is neither, and making it blocking means a subjective suggestion or an API hiccup can hold up a merge — the predictable result is someone disabling the whole thing. Review findings are advice, acted on or dismissed at the PR author's judgment.
- **Authenticates via `CLAUDE_CODE_OAUTH_TOKEN`, not a separate `ANTHROPIC_API_KEY`.** A deliberate deviation from this feature's original design (which specified a standalone API key billed as separate API credits): `/install-github-app`'s setup flow already provisioned this token, so review runs bill against the Claude subscription's usage instead — one less secret to obtain and rotate, at the cost of not being billing-isolated from everything else built with that subscription. `--max-turns 30` and `timeout-minutes: 15` still bound a single run's cost; `paths-ignore` skips doc-only changes entirely; `concurrency` with `cancel-in-progress` means pushing several commits in quick succession only bills for the last review, not one per push.
- **Trigger is `pull_request`, not `pull_request_target`.** This is a public repository — `pull_request_target` runs with access to repository secrets in the context of the *base* branch, which combined with untrusted fork code is a well-known way to leak a credential. Reviewing fork PRs at all is out of scope for now; it would need its own careful design (most likely running with reduced/no secret access).
- **Setup outside the codebase (one-time, repository-admin only):** install the Claude GitHub App and its Actions workflow via `/install-github-app` in a Claude Code terminal (needs a `gh` token with the `workflow` scope, `gh auth refresh -h github.com -s repo,workflow` if it's missing) — this both installs the GitHub App and provisions `CLAUDE_CODE_OAUTH_TOKEN` as a repository secret automatically. **The wizard also pushes its own generic scaffolding as a branch** (`claude-code-review.yml` plus an unrelated `claude.yml` for interactive `@claude` PR/issue mentions) — that branch was deliberately not merged here: it lacks this workflow's cost/scope controls (`paths-ignore`, `concurrency`, `timeout-minutes`, `--max-turns`), and the `@claude`-mention workflow is a separate feature outside this issue's scope. Delete that stray branch rather than merging it if it reappears from a future `/install-github-app` re-run.
- `permissions.id-token: write` is required, not optional — confirmed directly: without it, `claude-code-action@v1` fails immediately with "Could not fetch an OIDC token" before it ever gets to reviewing anything. It authenticates against the installed GitHub App via OIDC, not just for the "read CI results" purpose some upstream examples' comments suggest.
- **It reviews a PR once, not on every push.** The skill's first step stops if Claude has already commented on the PR, so pushes after that first review exit in ~10s having reviewed nothing. The check still goes green, which makes it easy to misread as "the latest code was reviewed" — it isn't. A green `review` on a follow-up push means only that the workflow ran. Re-reviewing a fix means asking for one explicitly (`@claude review` on the PR), or judging it the usual way: a test that fails before the fix and passes after.
- **A PR that itself adds or modifies this workflow file won't be reviewed by it.** The GitHub App validates that the workflow file running matches what's on `main` before executing — a PR changing the file necessarily fails that check once, harmlessly (`gh run view` shows "Workflow validation failed... this is normal... your workflow will begin working once you merge"). Expected, not a bug to chase.
- **`fetch-depth: 0` (full history), not the upstream `claude.yml` example's `fetch-depth: 1`.** A depth-1 checkout has no base-branch history to diff against, which seemed at first to fully explain an early run that completed (real turns, real cost) but posted nothing anywhere. It turned out to be one of two causes, not the whole story — see the next point — but there's no reason to run PR review against a shallow checkout regardless, so it stayed at 0.
- **`--comment` is a required argument, not implied.** The `/code-review:code-review` skill's own upstream instructions (`plugins/code-review/commands/code-review.md` in `anthropics/claude-code`) say explicitly: without `--comment`, it stops after printing its findings to its own transcript and posts nothing to GitHub at all — confirmed directly, twice, as the actual explanation for "review ran, cost real money, posted nothing." The skill also declares its own tool needs in frontmatter (`Bash(gh pr comment:*)`, `Bash(gh pr diff:*)`, `mcp__github_inline_comment__create_inline_comment`, etc.) — that declaration alone doesn't grant them in an Actions context, so `--allowedTools` repeats the same list explicitly.

#### Review standards
The reviewer reads this file the same as any Claude Code session, so pointing it at this project's actual failure modes (rather than leaving it to generic advice) belongs here rather than in the workflow's prompt:
- **Offline correctness** — any new save path must go through the IndexedDB queue in `db.js` (`queueAsset`/`queueRepair`/`queueRepairComment`, or the same shape for a new entity), never a direct Supabase call from a view. This is the easiest thing to get wrong here and the most damaging in the field — see "Offline strategy".
- **Sync ordering** — `sync.js`'s `syncAll()` must sync assets, then repairs, then repair comments, in that order; each references the row before it as a foreign key.
- **Security** — the Supabase *service role* key must never appear anywhere in this codebase (only the publishable/anon key belongs in client code); RLS assumptions in "Row Level Security" shouldn't be silently bypassed or reinterpreted; no secrets or tokens in logs or error messages.
- **Auth gates** — a change to `main.js`'s routing must preserve the gate order in "Routing and auth/profile gates" and must not break `isProfileComplete()`'s fail-open behavior (a broken profile query should never lock a field worker out of the app) or its `sessionCheckedOnce` guard against startup `SIGNED_IN` noise.
- **Test coverage** — new pure logic (validation, formatting, queue/sync logic) needs Vitest coverage; a new or changed user-facing flow needs a Playwright spec — see "Testing conventions".
- **Conventions** — vanilla HTML/CSS/JS, no UI framework or new dependency without clear justification; views follow the existing render-from-scratch pattern in "View pattern" rather than introducing partial DOM patching.

Flag security and correctness issues loudly; style suggestions quietly — the point is separating signal from noise, not maximizing comment count.

## Commands
- `npm run dev` — Vite dev server
- `npm run build` — production build (also used by the deploy workflow)
- `npm run build:e2e` — production build against `.env.e2e` instead (`vite build --mode e2e`) — what the e2e suite actually runs against
- `npm run preview` — serve the production build locally
- `npm test` — run Vitest once
- `npm run test:watch` — Vitest watch mode
- `npm run test:e2e` — run the Playwright suite (builds + previews first, per `playwright.config.js`'s `webServer`)
- `npm run test:e2e:ui` — same, with Playwright's debugging UI
- `npm run lint` — ESLint
