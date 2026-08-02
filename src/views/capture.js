import { getSession } from '../auth.js';
import {
  validateAssetForm,
  validateRepairForm,
  photoLimitReached,
  MAX_ASSET_PHOTOS,
} from '../validation.js';
import { downscaleImage, buildPhotoPath } from '../camera.js';
import { queueAsset, queuePhoto, queueRepair } from '../db.js';
import { syncAll } from '../sync.js';
import { CONDITION_VALUES, formatCondition } from '../format.js';
import { confirmDialog } from '../confirmDialog.js';

function nowForDateTimeLocal() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

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

export function renderCapture(container, { navigate }) {
  container.innerHTML = `
    <section class="view view-capture">
      <header class="view-header">
        <button type="button" class="link-button" id="back">&larr; Assets</button>
        <h1>New asset</h1>
      </header>
      <form id="capture-form" novalidate>
        <label>
          Asset name
          <input type="text" name="assetName" required />
        </label>
        <p class="field-error" data-error-for="assetName" hidden></p>

        <!-- The input is hidden and opened by the button below, rather
             than being the control itself: it needs to be re-triggered
             once per photo, and a native file input gives no room for a
             tap target sized for a tablet or for a label that changes
             with the count. -->
        <p class="photo-section-label" id="photos-label">Photos</p>
        <input
          type="file"
          id="photo-input"
          accept="image/*"
          capture="environment"
          hidden
        />
        <ul class="photo-grid" id="photo-grid" aria-labelledby="photos-label"></ul>
        <button type="button" id="add-photo-button">Add photo</button>
        <p class="asset-meta" id="photo-limit-note" hidden></p>

        <label>
          Date/time
          <input type="datetime-local" name="recordedAt" value="${nowForDateTimeLocal()}" required />
        </label>
        <p class="field-error" data-error-for="recordedAt" hidden></p>

        <label>
          Description
          <textarea name="description" rows="3" required></textarea>
        </label>
        <p class="field-error" data-error-for="description" hidden></p>

        <!-- Explicit for/id, not a wrapping label like the other fields
             here - a <select>'s accessible name, when wrapped, otherwise
             concatenates every <option>'s own text alongside the label
             text, making it unmatchable by its plain label text alone. -->
        <label for="condition-select">Condition</label>
        <select id="condition-select" name="condition">
          <option value="">Not set</option>
          ${CONDITION_VALUES.map(
            (value) => `<option value="${value}">${formatCondition(value)}</option>`
          ).join('')}
        </select>
        <p class="field-error" data-error-for="condition" hidden></p>

        <label>
          Condition note
          <input type="text" name="conditionNote" maxlength="200" />
        </label>
        <p class="field-error" data-error-for="conditionNote" hidden></p>

        <!-- capture-repairs, not the shared #repairs-section id, which
             detail.js also uses for a section laid out quite differently.
             Only this form needs the sub-panel treatment. -->
        <div id="repairs-section" class="capture-repairs"></div>

        <p class="form-error" id="submit-error" role="alert" hidden></p>
        <div class="edit-actions">
          <button type="submit">Save asset</button>
          <!-- Lighter .link-button next to the primary action, the same
               pairing detail.js's edit form already uses for Save/Cancel -
               it reads as the secondary choice without needing a size of
               its own. type="button" matters: inside a <form>, a button
               with no type submits it. -->
          <button type="button" id="cancel-capture" class="link-button">Cancel</button>
        </div>
      </form>
    </section>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('#/register'));
  // Same destination as the header's back button - two ways out of the
  // form, one at the top and one beside the action you'd otherwise take.
  // Neither warns about unsaved input, deliberately consistent with each
  // other rather than one of them being stricter.
  container
    .querySelector('#cancel-capture')
    .addEventListener('click', () => navigate('#/register'));

  const form = container.querySelector('#capture-form');

  // { localId, blob, url } - url is an object URL for the thumbnail,
  // revoked on removal so a long capture session doesn't leak them.
  const pendingPhotos = [];
  const photoInput = container.querySelector('#photo-input');
  const photoGrid = container.querySelector('#photo-grid');
  const addPhotoButton = container.querySelector('#add-photo-button');
  const photoLimitNote = container.querySelector('#photo-limit-note');

  function drawPhotoGrid() {
    photoGrid.innerHTML = pendingPhotos
      .map(
        (photo, index) => `
        <li class="photo-grid-item">
          <img src="${photo.url}" alt="Photo ${index + 1}" class="photo-thumb" />
          <button type="button" class="link-button remove-photo-button" data-local-id="${photo.localId}">
            Remove
          </button>
        </li>
      `
      )
      .join('');

    for (const button of photoGrid.querySelectorAll('.remove-photo-button')) {
      button.addEventListener('click', async () => {
        const photo = pendingPhotos.find((p) => p.localId === button.dataset.localId);
        if (!photo) return;
        // Through the shared confirm rather than a bespoke one: a
        // mis-tap here means walking back to re-photograph the asset.
        const confirmed = await confirmDialog({
          message: 'Remove this photo? You can take another one instead.',
          confirmLabel: 'Remove',
        });
        if (!confirmed) return;

        URL.revokeObjectURL(photo.url);
        pendingPhotos.splice(pendingPhotos.indexOf(photo), 1);
        drawPhotoGrid();
      });
    }

    // Says why rather than going quiet when tapped - a control that
    // silently does nothing reads as broken.
    const atLimit = photoLimitReached(pendingPhotos.length);
    addPhotoButton.disabled = atLimit;
    photoLimitNote.hidden = !atLimit;
    photoLimitNote.textContent = atLimit
      ? `Maximum of ${MAX_ASSET_PHOTOS} photos. Remove one to add another.`
      : '';
  }

  addPhotoButton.addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    // Cleared straight away, before any await: without this, taking the
    // same file twice in a row fires no change event at all and the
    // second photo vanishes with no error.
    photoInput.value = '';
    if (!file) return;
    if (photoLimitReached(pendingPhotos.length)) return;

    addPhotoButton.disabled = true;
    try {
      const blob = await downscaleImage(file);
      pendingPhotos.push({
        localId: crypto.randomUUID(),
        blob,
        url: URL.createObjectURL(blob),
      });
      drawPhotoGrid();
    } finally {
      // drawPhotoGrid owns the disabled state whenever it runs; this
      // only matters on the path where downscaling threw.
      if (!photoLimitReached(pendingPhotos.length)) addPhotoButton.disabled = false;
    }
  });

  drawPhotoGrid();

  const repairsSection = container.querySelector('#repairs-section');
  let pendingRepairs = [];
  let editingLocalId = null;
  let addingNew = false;

  function renderRepairItem(repair) {
    if (repair.localId === editingLocalId) {
      return `
        <li class="repair-item" data-local-id="${repair.localId}">
          <label>
            Repair description
            <textarea class="edit-repair-textarea" rows="2">${escapeHtml(repair.description)}</textarea>
          </label>
          <p class="field-error edit-repair-error" hidden></p>
          <div class="edit-actions">
            <button type="button" class="save-edit-repair-button" data-local-id="${repair.localId}">
              Save repair
            </button>
            <button
              type="button"
              class="link-button cancel-edit-repair-button"
              data-local-id="${repair.localId}"
            >
              Cancel
            </button>
          </div>
        </li>
      `;
    }
    return `
      <li class="repair-item" data-local-id="${repair.localId}">
        <p class="repair-description">${escapeHtml(repair.description)}</p>
        <p class="asset-meta">
          Added by ${escapeHtml(repair.createdByEmail)} · ${new Date(repair.reportedAt).toLocaleString()}
        </p>
        <button type="button" class="link-button edit-repair-button" data-local-id="${repair.localId}">
          Edit
        </button>
      </li>
    `;
  }

  function drawRepairsSection() {
    repairsSection.innerHTML = `
      <h2>Repairs</h2>
      <ul class="repair-list">
        ${pendingRepairs.map(renderRepairItem).join('')}
      </ul>
      <button type="button" id="new-repair-button" ${addingNew ? 'hidden' : ''}>New repair</button>
      <div id="new-repair-form" ${addingNew ? '' : 'hidden'}>
        <label>
          Repair description
          <textarea id="new-repair-description" rows="2"></textarea>
        </label>
        <p class="field-error" id="new-repair-error" hidden></p>
        <div class="edit-actions">
          <button type="button" id="save-repair-button">Save repair</button>
          <button type="button" id="cancel-repair-button" class="link-button">Cancel</button>
        </div>
      </div>
    `;

    repairsSection.querySelector('#new-repair-button').addEventListener('click', () => {
      // Only one repair can be in "new" or "edit" mode at a time.
      editingLocalId = null;
      addingNew = true;
      drawRepairsSection();
    });

    repairsSection.querySelector('#cancel-repair-button').addEventListener('click', () => {
      addingNew = false;
      drawRepairsSection();
    });

    repairsSection.querySelector('#save-repair-button').addEventListener('click', async () => {
      const textarea = repairsSection.querySelector('#new-repair-description');
      const errorEl = repairsSection.querySelector('#new-repair-error');
      const { valid } = validateRepairForm({ description: textarea.value });
      if (!valid) {
        errorEl.hidden = false;
        errorEl.textContent = 'Repair description is required.';
        return;
      }

      const saveButton = repairsSection.querySelector('#save-repair-button');
      saveButton.disabled = true;

      const session = await getSession();
      pendingRepairs.push({
        localId: crypto.randomUUID(),
        description: textarea.value.trim(),
        reportedAt: new Date().toISOString(),
        createdByEmail: session?.user?.email ?? 'Unknown',
      });
      addingNew = false;
      drawRepairsSection();
    });

    for (const button of repairsSection.querySelectorAll('.edit-repair-button')) {
      button.addEventListener('click', () => {
        // Only one repair can be in "new" or "edit" mode at a time.
        addingNew = false;
        editingLocalId = button.dataset.localId;
        drawRepairsSection();
      });
    }

    for (const button of repairsSection.querySelectorAll('.cancel-edit-repair-button')) {
      button.addEventListener('click', () => {
        editingLocalId = null;
        drawRepairsSection();
      });
    }

    for (const button of repairsSection.querySelectorAll('.save-edit-repair-button')) {
      button.addEventListener('click', () => {
        const item = repairsSection.querySelector(`.repair-item[data-local-id="${button.dataset.localId}"]`);
        const textarea = item.querySelector('.edit-repair-textarea');
        const errorEl = item.querySelector('.edit-repair-error');
        const { valid } = validateRepairForm({ description: textarea.value });
        if (!valid) {
          errorEl.hidden = false;
          errorEl.textContent = 'Repair description is required.';
          return;
        }

        const repair = pendingRepairs.find((r) => r.localId === button.dataset.localId);
        repair.description = textarea.value.trim();
        editingLocalId = null;
        drawRepairsSection();
      });
    }
  }

  drawRepairsSection();

  function showFieldErrors(errors) {
    for (const el of form.querySelectorAll('.field-error')) {
      el.hidden = true;
      el.textContent = '';
    }
    for (const [field, message] of Object.entries(errors)) {
      const el = form.querySelector(`[data-error-for="${field}"]`);
      if (el) {
        el.hidden = false;
        el.textContent = message;
      }
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitError = container.querySelector('#submit-error');
    submitError.hidden = true;

    const assetName = form.assetName.value;
    const description = form.description.value;
    const recordedAt = form.recordedAt.value;
    // '' (the "Not set" option) means unset, not an empty string worth
    // storing - normalised to null before it ever reaches validation or
    // the queue.
    const condition = form.condition.value || null;
    const conditionNote = form.conditionNote.value.trim() || null;

    const { valid, errors } = validateAssetForm({
      assetName,
      description,
      recordedAt,
      condition,
      conditionNote,
    });
    showFieldErrors(errors);
    if (!valid) return;

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    try {
      const session = await getSession();
      const assetId = crypto.randomUUID();
      const recordedAtIso = new Date(recordedAt).toISOString();

      const photosToQueue = pendingPhotos.map((photo, index) => ({
        id: crypto.randomUUID(),
        assetId,
        storagePath: buildPhotoPath(session.user.id),
        position: index + 1,
        blob: photo.blob,
      }));

      // Write to the offline queue first, then try to sync immediately —
      // if the network drops mid-sync the record just stays queued and
      // the 'online' listener in main.js retries it later.
      await queueAsset({
        id: assetId,
        assetName: assetName.trim(),
        description: description.trim(),
        recordedAt: recordedAtIso,
        // No photo on the asset record itself: the photos are queued
        // separately below, as their own records.
        photo: null,
        condition,
        conditionNote,
      });

      for (const photo of photosToQueue) {
        await queuePhoto(photo);
      }

      for (const repair of pendingRepairs) {
        await queueRepair({
          id: crypto.randomUUID(),
          assetId,
          description: repair.description,
          reportedAt: repair.reportedAt,
          completedAt: null,
          createdByEmail: repair.createdByEmail,
        });
      }

      if (navigator.onLine) {
        await syncAll();
      }

      navigate('#/register');
    } catch (err) {
      submitError.hidden = false;
      submitError.textContent = err.message || 'Could not save this asset. Try again.';
    } finally {
      submitButton.disabled = false;
    }
  });
}
