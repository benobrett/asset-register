import { getSession } from '../auth.js';
import { validateAssetForm } from '../validation.js';
import { watchPhotoPreview, buildPhotoPath } from '../camera.js';
import { queueAsset } from '../db.js';
import { syncQueuedAssets } from '../sync.js';

function nowForDateTimeLocal() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function renderCapture(container, { navigate }) {
  container.innerHTML = `
    <section class="view view-capture">
      <header class="view-header">
        <button type="button" class="link-button" id="back">&larr; Home</button>
        <h1>New asset</h1>
      </header>
      <form id="capture-form" novalidate>
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

        <label class="checkbox-label">
          <input type="checkbox" name="repairNeeded" />
          Repair needed
        </label>

        <label id="repair-description-label" hidden>
          Repair description
          <textarea name="repairDescription" rows="2"></textarea>
        </label>
        <p class="field-error" data-error-for="repairDescription" hidden></p>

        <p class="form-error" id="submit-error" role="alert" hidden></p>
        <button type="submit">Save asset</button>
      </form>
    </section>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('#/home'));

  const form = container.querySelector('#capture-form');
  const photoInput = form.photo;
  const photoPreview = container.querySelector('#photo-preview');
  watchPhotoPreview(photoInput, photoPreview);

  const repairCheckbox = form.repairNeeded;
  const repairLabel = container.querySelector('#repair-description-label');
  repairCheckbox.addEventListener('change', () => {
    repairLabel.hidden = !repairCheckbox.checked;
  });

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

    const description = form.description.value;
    const recordedAt = form.recordedAt.value;
    const repairNeeded = repairCheckbox.checked;
    const repairDescription = form.repairDescription.value;

    const { valid, errors } = validateAssetForm({
      description,
      recordedAt,
      repairNeeded,
      repairDescription,
    });
    showFieldErrors(errors);
    if (!valid) return;

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    try {
      const session = await getSession();
      const file = photoInput.files[0];
      const photoPath = file ? buildPhotoPath(session.user.id, file) : null;

      // Write to the offline queue first, then try to sync immediately —
      // if the network drops mid-sync the record just stays queued and
      // the 'online' listener in main.js retries it later.
      await queueAsset({
        id: crypto.randomUUID(),
        description: description.trim(),
        recordedAt: new Date(recordedAt).toISOString(),
        photoPath,
        photo: file ?? null,
        repairNeeded,
        repairDescription: repairNeeded ? repairDescription.trim() : null,
      });

      if (navigator.onLine) {
        await syncQueuedAssets();
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
