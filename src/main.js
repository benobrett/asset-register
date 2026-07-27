import { getSession, onAuthChange, isProfileComplete, resetProfileCache } from './auth.js';
import { renderLogin } from './views/login.js';
import { renderForgotPassword } from './views/forgotPassword.js';
import { renderResetPassword } from './views/resetPassword.js';
import { renderRegister } from './views/register.js';
import { renderCapture } from './views/capture.js';
import { renderDetail } from './views/detail.js';
import { renderCompleteProfile } from './views/completeProfile.js';
import { syncAll, watchConnectivity } from './sync.js';

const app = document.getElementById('app');

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

function navigate(hash) {
  if (window.location.hash === hash) {
    route();
  } else {
    window.location.hash = hash;
  }
}

let currentSession = null;

async function route() {
  const hash = window.location.hash || '#/register';

  if (!currentSession) {
    currentSession = await getSession();
  }

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

  for (const { pattern, view } of routes) {
    const match = hash.match(pattern);
    if (match) {
      view(app, { navigate, params: match.groups || {} });
      return;
    }
  }

  app.innerHTML = '<p>Page not found.</p>';
}

onAuthChange((session) => {
  currentSession = session;
  // A different account may now be signed in - never reuse the previous
  // one's cached profile-completeness.
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
