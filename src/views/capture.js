import { getSession } from '../auth.js';
import { validateAssetForm, validateRepairForm } from '../validation.js';
import { watchPhotoPreview, buildPhotoPath } from '../camera.js';
import { queueAsset, queueRepair } from '../db.js';
import { syncAll } from '../sync.js';

function nowForDateTimeLocal() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
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

        <label>
          Photo
          <input type="file" name="photo" accept="image/*" capture="environment" />
        </label>
        <img id="photo-preview" alt="Photo preview" hidden />

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

        <div id="repairs-section"></div>

        <p class="form-error" id="submit-error" role="alert" hidden></p>
        <button type="submit">Save asset</button>
      </form>
    </section>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('#/register'));

  const form = container.querySelector('#capture-form');
  const photoInput = form.photo;
  const photoPreview = container.querySelector('#photo-preview');
  watchPhotoPreview(photoInput, photoPreview);

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

    const { valid, errors } = validateAssetForm({ assetName, description, recordedAt });
    showFieldErrors(errors);
    if (!valid) return;

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    try {
      const session = await getSession();
      const file = photoInput.files[0];
      const photoPath = file ? buildPhotoPath(session.user.id, file) : null;

      const assetId = crypto.randomUUID();
      const recordedAtIso = new Date(recordedAt).toISOString();

      // Write to the offline queue first, then try to sync immediately —
      // if the network drops mid-sync the record just stays queued and
      // the 'online' listener in main.js retries it later.
      await queueAsset({
        id: assetId,
        assetName: assetName.trim(),
        description: description.trim(),
        recordedAt: recordedAtIso,
        photoPath,
        photo: file ?? null,
      });

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
