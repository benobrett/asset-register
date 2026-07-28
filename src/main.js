import { getSession, onAuthChange, isProfileComplete, resetProfileCache } from './auth.js';
import { renderLogin } from './views/login.js';
import { renderForgotPassword } from './views/forgotPassword.js';
import { renderResetPassword } from './views/resetPassword.js';
import { renderRegister } from './views/register.js';
import { renderCapture } from './views/capture.js';
import { renderDetail } from './views/detail.js';
import { renderCompleteProfile } from './views/completeProfile.js';
import { syncAll, watchConnectivity } from './sync.js';
import { mountProfileMenu } from './profileMenu.js';

const app = document.getElementById('app');

// Mounted once, outside #app, so it survives every view re-render - see
// CLAUDE.md "Persistent chrome". route() only ever updates its
// visibility and contents; it is never re-created.
const updateProfileMenu = mountProfileMenu(document.getElementById('app-chrome'), { navigate });

const routes = [
  { pattern: /^#\/login$/, view: renderLogin, public: true },
  { pattern: /^#\/forgot-password$/, view: renderForgotPassword, public: true },
  { pattern: /^#\/reset-password$/, view: renderResetPassword, public: true },
  { pattern: /^#\/complete-profile$/, view: renderCompleteProfile },
  { pattern: /^#\/register$/, view: renderRegister },
  { pattern: /^#\/capture$/, view: renderCapture },
  { pattern: /^#\/asset\/(?<id>[^/]+)$/, view: renderDetail },
];

// Reachable with no session at all - #/login and #/forgot-password for the
// obvious reason (nobody's logged in yet), and #/reset-password because a
// stale/reused recovery link means the PKCE code exchange never actually
// established a session; that view has its own "expired link" branch for
// that case rather than being bounced to #/login before it can show it.
const PUBLIC_HASHES = new Set(['#/login', '#/forgot-password', '#/reset-password']);

// The only onAuthChange events worth a full profile-recheck + re-render
// for - see the listener below for why the others are ignored.
const AUTH_TRANSITION_EVENTS = new Set(['SIGNED_IN', 'SIGNED_OUT', 'PASSWORD_RECOVERY']);

function navigate(hash) {
  if (window.location.hash === hash) {
    route();
  } else {
    window.location.hash = hash;
  }
}

let currentSession = null;
// Set once route()'s own session check has resolved for the first time -
// see the onAuthChange listener below for why this matters.
let sessionCheckedOnce = false;

async function route() {
  const hash = window.location.hash || '#/register';

  if (!currentSession) {
    currentSession = await getSession();
  }
  sessionCheckedOnce = true;

  if (!currentSession && !PUBLIC_HASHES.has(hash)) {
    window.location.hash = '#/login';
    return;
  }
  if (currentSession && hash === '#/login') {
    window.location.hash = '#/register';
    return;
  }
  // The Home screen no longer exists — send stale bookmarks/history
  // entries to the Assets screen rather than a "Page not found."
  if (hash === '#/home') {
    window.location.hash = '#/register';
    return;
  }

  // Blocks entry to the rest of the app until the account has a name on
  // file - legacy accounts from before this existed, and any account
  // that never went through the signup form's name fields. #/reset-password
  // is exempt too: clicking a recovery link establishes a session, and
  // without this exemption that session would get hijacked straight to
  // #/complete-profile before the user ever gets to set their password.
  if (
    currentSession &&
    hash !== '#/complete-profile' &&
    hash !== '#/reset-password' &&
    !(await isProfileComplete())
  ) {
    window.location.hash = '#/complete-profile';
    return;
  }
  // Nothing left to do there once the name's already on file - e.g. a
  // stale bookmark, or the back button, after already completing it.
  if (currentSession && hash === '#/complete-profile' && (await isProfileComplete())) {
    window.location.hash = '#/register';
    return;
  }

  // After the gates, before the view renders: the gates are the single
  // source of truth about whether there's a usable session, and gate 4
  // above is what populates the cached profile name this reads. Redirect
  // paths return early without touching it - each one re-enters route()
  // via hashchange, and that pass updates the chrome for the hash that
  // actually renders.
  updateProfileMenu(currentSession, hash);

  for (const { pattern, view } of routes) {
    const match = hash.match(pattern);
    if (match) {
      view(app, { navigate, params: match.groups || {} });
      return;
    }
  }

  app.innerHTML = '<p>Page not found.</p>';
}

onAuthChange((session, event) => {
  // Always kept fresh, regardless of event - harmless, and route() itself
  // reads this rather than calling getSession() again on every check.
  currentSession = session;

  // Supabase fires this listener for more than just sign-in/sign-out -
  // INITIAL_SESSION on every single page load (redundant with the
  // explicit route() call below, which already handles first paint) and
  // TOKEN_REFRESHED periodically in the background while nothing the
  // user did actually changed. Resetting the profile cache and doing a
  // full re-render for those was pure redundant work: 2-3x the queries
  // and re-renders for a single real sign-in, no user-visible bug, but
  // enough churn that an e2e spec had to wait for the network to settle
  // before it could interact reliably. Only a genuine transition
  // warrants a fresh profile-completeness check - a different account
  // may now be signed in, so the previous one's cached result can't be
  // reused.
  if (!AUTH_TRANSITION_EVENTS.has(event)) return;

  // Supabase can also fire SIGNED_IN itself while restoring a pre-existing
  // session on page load, not just on a genuine interactive sign-in - not
  // documented, but observed directly (via an e2e spec that lost text
  // typed into a form moments after load, because this handler tore the
  // view down again right underneath it). route()'s own session check
  // below already handles first paint, so any transition event arriving
  // before that first check has resolved is startup noise, not a real
  // transition - skip it rather than doubling up on the render it's
  // about to do anyway.
  if (!sessionCheckedOnce) return;

  resetProfileCache();
  route();
});

window.addEventListener('hashchange', route);
route();

// Retry any records queued while offline: once on load, and again whenever
// connectivity comes back.
watchConnectivity();
if (navigator.onLine) {
  syncAll();
}
