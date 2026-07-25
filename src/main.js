import { getSession, onAuthChange } from './auth.js';
import { renderLogin } from './views/login.js';
import { renderRegister } from './views/register.js';
import { renderCapture } from './views/capture.js';
import { renderDetail } from './views/detail.js';
import { syncAll, watchConnectivity } from './sync.js';

const app = document.getElementById('app');

const routes = [
  { pattern: /^#\/login$/, view: renderLogin, public: true },
  { pattern: /^#\/register$/, view: renderRegister },
  { pattern: /^#\/capture$/, view: renderCapture },
  { pattern: /^#\/asset\/(?<id>[^/]+)$/, view: renderDetail },
];

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

  if (!currentSession && hash !== '#/login') {
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
