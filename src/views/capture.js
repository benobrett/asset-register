import { getSession } from '../auth.js';
import {
  validateAssetForm,
  validateRepairForm,
  photoLimitReached,
  MAX_ASSET_PHOTOS,
} from '../validation.js';
import { downscaleImage, buildPhotoPath } from '../camera.js';
import {
  queueAsset,
  queuePhoto,
  queueRepair,
  saveDraft as persistDraft,
  getDraft,
  clearDraft,
} from '../db.js';
import { syncAll } from '../sync.js';
import { CONDITION_VALUES, formatCondition } from '../format.js';
import { confirmDialog } from '../confirmDialog.js';

// One draft, for this one form. See "Android capture lifecycle" in
// CLAUDE.md for why in-progress state is written to storage at all.
const DRAFT_ID = 'capture';

// Text fields worth restoring. Deliberately a list rather than "every
// input in the form": repair sub-forms come and go, and a stale value
// restored into one of those would be worse than losing it.
const DRAFT_FIELDS = ['assetName', 'description', 'recordedAt', 'condition', 'conditionNote'];

/**
 * Reduce a form to the values worth persisting. Pure and exported so the
 * round-trip is testable without a browser - the restore path is the one
 * that has to survive the page being destroyed, and it's the one nobody
 * will exercise by hand.
 */
export function readDraftFields(formValues) {
  const draft = {};
  for (const field of DRAFT_FIELDS) {
    const value = formValues?.[field];
    if (typeof value === 'string' && value !== '') draft[field] = value;
  }
  return draft;
}

/**
 * Is there anything here worth restoring? An untouched form auto-fills
 * recordedAt, so "has any key" would treat simply opening the screen as a
 * draft and offer to restore nothing.
 */
export function draftHasContent(draft) {
  if (!draft) return false;
  const meaningful = DRAFT_FIELDS.filter((field) => field !== 'recordedAt');
  return meaningful.some((field) => draft[field]) || (draft.photos?.length ?? 0) > 0;
}

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
        <p class="field-error" id="photo-error" role="alert" hidden></p>

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

  // Leaving deliberately discards the draft. Restoring it later would be
  // worse than losing it: the next new-asset capture would silently start
  // pre-filled with a previous asset's details, which is how you get the
  // wrong description attached to the right photo.
  const leave = async () => {
    try {
      await clearDraft(DRAFT_ID);
    } catch (err) {
      console.error('Could not clear the capture draft:', err);
    }
    navigate('#/register');
  };

  container.querySelector('#back').addEventListener('click', leave);
  // Same destination as the header's back button - two ways out of the
  // form, one at the top and one beside the action you'd otherwise take.
  // Neither warns about unsaved input, deliberately consistent with each
  // other rather than one of them being stricter.
  container.querySelector('#cancel-capture').addEventListener('click', leave);

  const form = container.querySelector('#capture-form');

  // { localId, blob, url } - url is an object URL for the thumbnail,
  // revoked on removal so a long capture session doesn't leak them.
  const pendingPhotos = [];
  const photoInput = container.querySelector('#photo-input');
  const photoGrid = container.querySelector('#photo-grid');
  const addPhotoButton = container.querySelector('#add-photo-button');
  const photoLimitNote = container.querySelector('#photo-limit-note');
  const photoError = container.querySelector('#photo-error');

  function showPhotoError(message) {
    photoError.hidden = !message;
    photoError.textContent = message ?? '';
  }

  // Written on every change, not on a timer: the page can be destroyed at
  // any moment between the camera opening and returning, so there is no
  // safe interval to debounce by. Each write is a handful of strings plus
  // Blobs already in memory, into IndexedDB, off the main thread.
  async function saveDraft() {
    try {
      await persistDraft(DRAFT_ID, {
        ...readDraftFields(Object.fromEntries(new FormData(form))),
        // Blobs survive IndexedDB directly - that's the whole reason this
        // isn't localStorage. Object URLs are not persisted: they're tied
        // to this document and are dead after a reload, so the restore
        // path mints fresh ones.
        photos: pendingPhotos.map((photo) => ({ localId: photo.localId, blob: photo.blob })),
      });
    } catch (err) {
      // A failed draft write must never block capture - it's a safety
      // net, not the feature.
      console.error('Could not save the capture draft:', err);
    }
  }

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
        // Or the removed photo comes back on the next restore.
        saveDraft();
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
    showPhotoError(null);
    try {
      const blob = await downscaleImage(file);
      pendingPhotos.push({
        localId: crypto.randomUUID(),
        blob,
        url: URL.createObjectURL(blob),
      });
      drawPhotoGrid();
      await saveDraft();
    } catch (err) {
      // This used to be try/finally with no catch, so a failed capture
      // rejected into nothing: the user came back from the camera, saw no
      // photo, and got no reason. On Android that is indistinguishable
      // from the form having been wiped (issue #105), which made the two
      // failures impossible to tell apart from a bug report.
      console.error('Could not attach the photo:', err);
      showPhotoError('That photo could not be attached. Try taking it again.');
    } finally {
      // drawPhotoGrid owns the disabled state whenever it runs; this
      // only matters on the path where downscaling threw.
      if (!photoLimitReached(pendingPhotos.length)) addPhotoButton.disabled = false;
    }
  });

  drawPhotoGrid();

  // Any typed change persists the draft. 'input' rather than 'change' so
  // a half-typed title survives too - the camera can be opened at any
  // point, and 'change' on a text field only fires on blur.
  form.addEventListener('input', () => {
    saveDraft();
  });

  // Restore whatever was in the form when it was last destroyed. Runs
  // after the listeners above are wired, so nothing races the first save.
  //
  // Restored silently rather than behind a "restore your draft?" prompt:
  // the case this exists for is the user coming straight back from the
  // camera expecting their form to still be there. A dialog asking
  // whether they meant it would be its own small insult.
  (async () => {
    let draft;
    try {
      draft = await getDraft(DRAFT_ID);
    } catch (err) {
      console.error('Could not read the capture draft:', err);
      return;
    }
    if (!draftHasContent(draft)) return;

    for (const [field, value] of Object.entries(draft)) {
      if (field === 'photos') continue;
      const input = form.elements[field];
      if (input) input.value = value;
    }

    for (const photo of draft.photos ?? []) {
      if (photoLimitReached(pendingPhotos.length)) break;
      // Fresh object URL: the persisted one belonged to a document that
      // no longer exists.
      pendingPhotos.push({ ...photo, url: URL.createObjectURL(photo.blob) });
    }
    drawPhotoGrid();
  })();

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

      // Cleared only once the asset and its photos are safely in the
      // queue, not before: if anything above threw, the draft is still
      // the user's only copy of what they typed.
      await clearDraft(DRAFT_ID);

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
