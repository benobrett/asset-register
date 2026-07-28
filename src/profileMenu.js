// Persistent app chrome, mounted once from main.js into the header that
// sits *outside* #app - see CLAUDE.md "Persistent chrome". Views rewrite
// their own container wholesale on every re-render, so anything rendered
// inside one is destroyed and rebuilt whenever that view redraws; an open
// popover would vanish mid-interaction, and every new view would be a
// fresh chance to forget to include the icon at all.

import { getCachedProfileName, signOut } from './auth.js';
import { formatInitials, formatDisplayName } from './format.js';

// Anonymous outline rather than initials-from-email: an account with no
// name on file is exactly the case where a derived letter would be a
// guess, and the popover already names them by email underneath.
const PERSON_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
`;

// Hidden wherever a profile is meaningless or actively misleading:
// #/login and the password-reset routes have no signed-in identity to
// show, and #/complete-profile is a blocking gate for accounts with no
// name on file - an icon there would suggest a way out of a screen that
// is deliberately not offering one.
const CHROME_HIDDEN_HASHES = new Set([
  '#/login',
  '#/forgot-password',
  '#/reset-password',
  '#/complete-profile',
]);

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function mountProfileMenu(host, { navigate }) {
  host.innerHTML = `
    <button
      type="button"
      class="profile-button"
      id="profile-button"
      aria-expanded="false"
      aria-haspopup="dialog"
      aria-controls="profile-popover"
      aria-label="Your profile"
    ></button>
    <div class="profile-popover" id="profile-popover" role="dialog" aria-label="Your profile" hidden>
      <p class="profile-popover-name" id="profile-popover-name"></p>
      <button type="button" class="link-button profile-logout-button" id="profile-logout">
        Log out
      </button>
    </div>
  `;

  const button = host.querySelector('#profile-button');
  const popover = host.querySelector('#profile-popover');
  const nameEl = host.querySelector('#profile-popover-name');
  const logoutButton = host.querySelector('#profile-logout');

  let open = false;

  function setOpen(next) {
    open = next;
    popover.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  function close({ restoreFocus = false } = {}) {
    if (!open) return;
    setOpen(false);
    // Only when the close was user-initiated from within the popover
    // (Escape) - stealing focus back on a route change or an outside
    // click would yank it away from whatever the user just moved to.
    if (restoreFocus) button.focus();
  }

  button.addEventListener('click', () => setOpen(!open));

  // Sits here rather than in a view's own header, which is where it used
  // to live: on the register screen only, so it wasn't reachable at all
  // from capture or detail. As persistent chrome it's available on every
  // authenticated screen. Navigating to #/login re-enters route(), which
  // hides this whole element - no need to close it by hand first.
  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      await signOut();
      navigate('#/login');
    } finally {
      logoutButton.disabled = false;
    }
  });

  // Document-level and wired once for the component's whole life, rather
  // than added and removed around each open - nothing to leak.
  //
  // Capture phase specifically, because bubble phase isn't reliable here:
  // detail.js's repair Information/Comment handlers call
  // stopPropagation(), so those clicks would never reach a bubble-phase
  // listener on document, and the popover would sit open on top of the
  // panel they just opened. Capture runs before the target's own handler,
  // so it can't be cut off that way. Clicks on the chrome itself (the
  // toggle button, or inside the popover) are excluded below and left to
  // their own handlers.
  document.addEventListener(
    'click',
    (event) => {
      if (!open) return;
      if (host.contains(event.target)) return;
      close();
    },
    true
  );

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close({ restoreFocus: true });
  });

  // Dispatched by confirmDialog.js as it opens. The popover would
  // otherwise sit behind the modal backdrop (deliberate: z-index 95 vs
  // 100, see style.css) while still being technically open and
  // interactive-looking underneath it.
  document.addEventListener('app:modal-open', () => close());

  return function updateProfileMenu(session, hash) {
    // Every route change closes it - the popover describes the account,
    // not the screen, but leaving it hanging open across a navigation
    // reads as a rendering glitch.
    close();

    const visible = Boolean(session) && !CHROME_HIDDEN_HASHES.has(hash);
    host.hidden = !visible;
    if (!visible) return;

    const profile = getCachedProfileName(session.user?.id);
    const displayName = formatDisplayName({
      firstName: profile?.first_name,
      lastName: profile?.last_name,
      email: session.user?.email,
    });
    const initials = formatInitials({
      firstName: profile?.first_name,
      lastName: profile?.last_name,
    });

    button.innerHTML = initials ? escapeHtml(initials) : PERSON_ICON_SVG;
    // The visible initials are decorative shorthand for a name the
    // popover spells out - the accessible name carries the whole thing.
    button.setAttribute('aria-label', `Your profile: ${displayName}`);
    nameEl.textContent = displayName;
  };
}
