// Full-screen photo viewer. Shared UI like confirmDialog.js - it appends
// its own overlay to document.body rather than rendering into a view's
// container, so the view underneath is never re-rendered and the user
// stays exactly where they were.
//
// Deliberately NOT a history entry. Back-button-closes-the-overlay is a
// nice touch, but this app routes on window.location.hash, and pushing
// overlay state into history means the router has to tell "the user
// navigated" apart from "the user shut a picture" - a real source of
// confusion for a modest gain.

const CLOSE_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
`;

// No escaping helper here, unlike the other shared UI: nothing
// user-supplied reaches innerHTML in this file. The caption is set via
// textContent and the alt via the property, both of which take text as
// text. Keep it that way - if a caption ever gets interpolated into the
// template above, it needs escaping first.

// photos: [{ url, alt }]. returnFocusTo: the element that opened it,
// so focus goes back where it came from rather than to the top of the
// document.
export function openLightbox({ photos, startIndex = 0, returnFocusTo = null }) {
  if (!photos?.length) return;

  let index = Math.min(Math.max(startIndex, 0), photos.length - 1);
  const multiple = photos.length > 1;

  const overlay = document.createElement('div');
  overlay.className = 'lightbox-backdrop';
  overlay.innerHTML = `
    <div class="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div class="lightbox-bar">
        <p class="lightbox-position" id="lightbox-position"></p>
        <!-- Labelled, not just an X. An unlabelled icon in a corner is
             the single most common thing older users can't find on an
             overlay, and this app is used by exactly those staff. -->
        <button type="button" class="lightbox-close" id="lightbox-close">
          ${CLOSE_ICON_SVG}
          <span>Close</span>
        </button>
      </div>
      <div class="lightbox-stage">
        ${
          multiple
            ? `<button type="button" class="lightbox-nav lightbox-prev" id="lightbox-prev" aria-label="Previous photo">&#8249;</button>`
            : ''
        }
        <img class="lightbox-image" id="lightbox-image" alt="" />
        ${
          multiple
            ? `<button type="button" class="lightbox-nav lightbox-next" id="lightbox-next" aria-label="Next photo">&#8250;</button>`
            : ''
        }
      </div>
      <p class="lightbox-error" id="lightbox-error" hidden>
        This photo could not be loaded. It may have expired — reopen the asset to try again.
      </p>
    </div>
  `;

  const image = overlay.querySelector('#lightbox-image');
  const positionEl = overlay.querySelector('#lightbox-position');
  const errorEl = overlay.querySelector('#lightbox-error');
  const closeButton = overlay.querySelector('#lightbox-close');

  function show() {
    const photo = photos[index];
    errorEl.hidden = true;
    image.hidden = false;
    image.src = photo.url;
    image.alt = photo.alt ?? '';
    positionEl.textContent = multiple ? `${index + 1} of ${photos.length}` : '';
  }

  // A signed URL is short-lived, so a viewer left open long enough will
  // hit an expired one. Say so plainly rather than leaving the browser's
  // broken-image icon, which looks like the photo itself is gone.
  image.addEventListener('error', () => {
    image.hidden = true;
    errorEl.hidden = false;
  });

  function step(by) {
    index = (index + by + photos.length) % photos.length;
    show();
  }

  overlay.querySelector('#lightbox-prev')?.addEventListener('click', () => step(-1));
  overlay.querySelector('#lightbox-next')?.addEventListener('click', () => step(1));

  // Freezing the page behind, by taking the body out of flow at a
  // negative offset rather than by hiding its overflow.
  //
  // overflow: hidden was the first attempt and is not reliable here:
  // once the viewport has no scrollable overflow the browser resets the
  // position, and it was measured jumping straight to the top - the
  // user lost their place entirely on reopening the viewer. Pinning the
  // body keeps the rendered position identical while making it
  // genuinely unscrollable, and leaves the offset something this code
  // owns and can put back exactly.
  const scrollY = window.scrollY;
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  const previousStyles = {
    position: document.body.style.position,
    top: document.body.style.top,
    left: document.body.style.left,
    right: document.body.style.right,
    width: document.body.style.width,
    paddingRight: document.body.style.paddingRight,
  };
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  // Compensates for the scrollbar the browser stops reserving, which
  // would otherwise shift the page sideways as the overlay opens.
  if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

  function close() {
    document.removeEventListener('keydown', onKeydown, true);
    for (const [property, value] of Object.entries(previousStyles)) {
      document.body.style[property] = value;
    }
    overlay.remove();
    // Reading a layout property forces the style restore above to be
    // applied first. Without it the document is still the height of a
    // fixed body - maximum scroll zero - so the scroll below is clamped
    // straight back to the top and silently does nothing.
    void document.body.offsetHeight;
    // The body is back in flow but the document is at the top, since
    // that's where a fixed body left it - put the offset back.
    window.scrollTo(0, scrollY);
    // Back to the thumbnail that opened it, rather than dumping focus at
    // the top of the document. preventScroll so restoring focus can't
    // undo the scroll position restored on the line above.
    returnFocusTo?.focus?.({ preventScroll: true });
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (multiple && event.key === 'ArrowLeft') {
      step(-1);
      return;
    }
    if (multiple && event.key === 'ArrowRight') {
      step(1);
      return;
    }
    if (event.key !== 'Tab') return;

    // Focus trap: Tab off either end wraps back inside, so keyboard
    // focus can't wander into the page behind an overlay that covers it.
    const focusable = [...overlay.querySelectorAll('button')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  // Capture phase, matching profileMenu.js: a handler somewhere in the
  // page calling stopPropagation() shouldn't be able to swallow Escape.
  document.addEventListener('keydown', onKeydown, true);

  show();
  document.body.appendChild(overlay);
  // The close control gets focus, so the way out is the first thing a
  // keyboard or screen-reader user lands on. preventScroll for the same
  // reason as in close(), and it matters more here than it looks: the
  // overlay is position: fixed, so there is nothing to scroll it into
  // view, but the browser still moves the *document* behind it - it was
  // jumping straight to the top, losing the user's place entirely.
  closeButton.focus({ preventScroll: true });
}

