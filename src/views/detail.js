import { supabase, getPhotoUrl } from '../supabase.js';
import { validateAssetForm } from '../validation.js';
import { queueAsset } from '../db.js';
import { syncQueuedAssets } from '../sync.js';

function toDateTimeLocal(isoString) {
  const date = new Date(isoString);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

export async function renderDetail(container, { navigate, params }) {
  container.innerHTML = `
    <section class="view view-detail">
      <header class="view-header">
        <button type="button" class="link-button" id="back">&larr; Assets</button>
        <h1>Asset</h1>
      </header>
      <div id="detail-body"><p>Loading…</p></div>
    </section>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('#/register'));

  const { data, error } = await supabase
    .from('assets')
    .select(
      'id, asset_name, description, recorded_at, photo_path, repair_needed, repair_description, repair_completed_at'
    )
    .eq('id', params.id)
    .single();

  const body = container.querySelector('#detail-body');

  if (error || !data) {
    body.innerHTML = `<p>${escapeHtml(error?.message || 'Asset not found.')}</p>`;
    return;
  }

  let asset = data;
  let photoUrl = null;
  if (asset.photo_path) {
    try {
      photoUrl = await getPhotoUrl(asset.photo_path);
    } catch {
      // Photo failed to load a signed URL; render without it.
    }
  }

  function drawView() {
    body.innerHTML = `
      <article class="asset-detail">
        ${photoUrl ? `<img src="${photoUrl}" alt="Asset photo" class="asset-detail-photo" />` : ''}
        <dl>
          <dt>Asset name</dt>
          <dd>${escapeHtml(asset.asset_name)}</dd>
          <dt>Description</dt>
          <dd>${escapeHtml(asset.description)}</dd>
          <dt>Date/time</dt>
          <dd>${new Date(asset.recorded_at).toLocaleString()}</dd>
          <dt>Repair needed</dt>
          <dd>${asset.repair_needed ? 'Yes' : 'No'}</dd>
          ${
            asset.repair_needed
              ? `
            <dt>Repair description</dt>
            <dd>${escapeHtml(asset.repair_description)}</dd>
            <dt>Repair completed</dt>
            <dd>${asset.repair_completed_at ? new Date(asset.repair_completed_at).toLocaleString() : 'Outstanding'}</dd>
          `
              : ''
          }
        </dl>
        <button type="button" id="edit-button">Edit</button>
      </article>
    `;
    body.querySelector('#edit-button').addEventListener('click', drawEditForm);
  }

  function drawEditForm() {
    body.innerHTML = `
      <form id="edit-form" novalidate>
        <label>
          Asset name
          <input type="text" name="assetName" value="${escapeHtml(asset.asset_name)}" required />
        </label>
        <p class="field-error" data-error-for="assetName" hidden></p>

        <label>
          Date/time
          <input
            type="datetime-local"
            name="recordedAt"
            value="${toDateTimeLocal(asset.recorded_at)}"
            required
          />
        </label>
        <p class="field-error" data-error-for="recordedAt" hidden></p>

        <label>
          Description
          <textarea name="description" rows="3" required>${escapeHtml(asset.description)}</textarea>
        </label>
        <p class="field-error" data-error-for="description" hidden></p>

        <label class="checkbox-label">
          <input type="checkbox" name="repairNeeded" ${asset.repair_needed ? 'checked' : ''} />
          Repair needed
        </label>

        <label id="repair-description-label" ${asset.repair_needed ? '' : 'hidden'}>
          Repair description
          <textarea name="repairDescription" rows="2">${escapeHtml(asset.repair_description)}</textarea>
        </label>
        <p class="field-error" data-error-for="repairDescription" hidden></p>

        <label class="checkbox-label" id="repair-completed-label" ${asset.repair_needed ? '' : 'hidden'}>
          <input type="checkbox" name="repairCompleted" ${asset.repair_completed_at ? 'checked' : ''} />
          Repair completed
        </label>

        <p class="form-error" id="submit-error" role="alert" hidden></p>
        <div class="edit-actions">
          <button type="submit">Save</button>
          <button type="button" id="cancel-edit" class="link-button">Cancel</button>
        </div>
      </form>
    `;

    const form = body.querySelector('#edit-form');
    const repairCheckbox = form.repairNeeded;
    const repairLabel = form.querySelector('#repair-description-label');
    const repairCompletedLabel = form.querySelector('#repair-completed-label');

    repairCheckbox.addEventListener('change', () => {
      repairLabel.hidden = !repairCheckbox.checked;
      repairCompletedLabel.hidden = !repairCheckbox.checked;
    });

    form.querySelector('#cancel-edit').addEventListener('click', drawView);

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
      const submitError = form.querySelector('#submit-error');
      submitError.hidden = true;

      const assetName = form.assetName.value;
      const description = form.description.value;
      const recordedAt = form.recordedAt.value;
      const repairNeeded = repairCheckbox.checked;
      const repairDescription = form.repairDescription.value;
      const repairCompleted = form.repairCompleted.checked;

      const { valid, errors } = validateAssetForm({
        assetName,
        description,
        recordedAt,
        repairNeeded,
        repairDescription,
      });
      showFieldErrors(errors);
      if (!valid) return;

      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;

      // Marking "repair completed" for the first time stamps the current
      // time; re-saving while it's already checked keeps the original
      // timestamp rather than bumping it forward.
      const repairCompletedAt = !repairNeeded
        ? null
        : repairCompleted
          ? (asset.repair_completed_at ?? new Date().toISOString())
          : null;

      try {
        await queueAsset({
          id: asset.id,
          assetName: assetName.trim(),
          description: description.trim(),
          recordedAt: new Date(recordedAt).toISOString(),
          photoPath: asset.photo_path,
          photo: null,
          repairNeeded,
          repairDescription: repairNeeded ? repairDescription.trim() : null,
          repairCompletedAt,
        });

        if (navigator.onLine) {
          await syncQueuedAssets();
        }

        asset = {
          ...asset,
          asset_name: assetName.trim(),
          description: description.trim(),
          recorded_at: new Date(recordedAt).toISOString(),
          repair_needed: repairNeeded,
          repair_description: repairNeeded ? repairDescription.trim() : null,
          repair_completed_at: repairCompletedAt,
        };
        drawView();
      } catch (err) {
        submitError.hidden = false;
        submitError.textContent = err.message || 'Could not save this asset. Try again.';
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  drawView();
}
