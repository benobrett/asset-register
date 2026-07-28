// The textContent → innerHTML round-trip only escapes &, <, > (text-node
// concerns) - it leaves " and ' untouched, which is unsafe wherever the
// result is placed inside a quoted attribute (value="...", aria-label="...")
// rather than as element content. Escaping both here too costs nothing in
// the plain-text-content call sites and closes that gap everywhere this
// function is used.
function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// Promise resolves true on confirm, false on cancel/backdrop-click/Escape —
// all three are equivalent "nothing happens" outcomes for the caller.
export function confirmDialog({ message, confirmLabel = 'Delete', cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true">
        <p class="modal-message">${escapeHtml(message)}</p>
        <div class="edit-actions modal-actions">
          <button type="button" class="modal-confirm-button">${escapeHtml(confirmLabel)}</button>
          <button type="button" class="modal-cancel-button">${escapeHtml(cancelLabel)}</button>
        </div>
      </div>
    `;

    function close(result) {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      resolve(result);
    }

    function onKeydown(event) {
      if (event.key === 'Escape') close(false);
    }

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(false);
    });
    backdrop.querySelector('.modal-cancel-button').addEventListener('click', () => close(false));
    backdrop.querySelector('.modal-confirm-button').addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKeydown);

    // Announced rather than calling into the profile menu directly - this
    // dialog is generic shared UI and shouldn't know what chrome happens
    // to exist around it. Anything that must not stay open underneath a
    // modal listens for this. (The stacking order is settled separately
    // in style.css: this backdrop is z-index 100, the profile popover 95.)
    document.dispatchEvent(new CustomEvent('app:modal-open'));

    document.body.appendChild(backdrop);
    backdrop.querySelector('.modal-confirm-button').focus();
  });
}
