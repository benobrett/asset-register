import { supabase, getPhotoUrl } from '../supabase.js';
import { getSession } from '../auth.js';
import { validateAssetForm, validateRepairForm } from '../validation.js';
import { queueAsset, queueRepair } from '../db.js';
import { syncAll } from '../sync.js';
import { formatAssetId } from '../format.js';
import { confirmDialog } from '../confirmDialog.js';

const TRASH_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
  </svg>
`;

const INFO_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="16" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12.01" y2="8"></line>
  </svg>
`;

const CLOSE_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
`;

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

  const [assetResult, repairsResult] = await Promise.all([
    supabase
      .from('assets')
      .select('id, asset_number, asset_name, description, recorded_at, photo_path')
      .eq('id', params.id)
      .single(),
    supabase
      .from('asset_repairs')
      .select(
        'id, description, reported_at, completed_at, created_by_email, updated_at, updated_by_email, completed_by_email, completed_comment'
      )
      .eq('asset_id', params.id)
      .order('reported_at', { ascending: false }),
  ]);

  const body = container.querySelector('#detail-body');

  if (assetResult.error || !assetResult.data) {
    body.innerHTML = `<p>${escapeHtml(assetResult.error?.message || 'Asset not found.')}</p>`;
    return;
  }

  let asset = assetResult.data;
  let repairs = repairsResult.data || [];
  let repairsLoadError = repairsResult.error?.message || null;
  let editingRepairId = null;
  let addingRepair = false;
  let markingCompleteId = null;
  // Independent of the other three — viewing a repair's Information
  // alongside an open New/Edit/Mark-complete elsewhere is fine, so this
  // is never reset by (or resets) any of that state.
  let infoRepairId = null;
  let outsideInfoClickHandler = null;

  let photoUrl = null;
  if (asset.photo_path) {
    try {
      photoUrl = await getPhotoUrl(asset.photo_path);
    } catch {
      // Photo failed to load a signed URL; render without it.
    }
  }

  function renderRepairItem(repair) {
    if (repair.id === editingRepairId) {
      return `
        <li class="repair-item" data-id="${repair.id}">
          <label>
            Repair description
            <textarea class="edit-repair-textarea" rows="2">${escapeHtml(repair.description)}</textarea>
          </label>
          <p class="field-error edit-repair-error" hidden></p>
          <div class="edit-actions">
            <button type="button" class="save-edit-repair-button" data-id="${repair.id}">Save repair</button>
            <button type="button" class="link-button cancel-edit-repair-button" data-id="${repair.id}">
              Cancel
            </button>
          </div>
        </li>
      `;
    }

    if (repair.id === markingCompleteId) {
      return `
        <li class="repair-item" data-id="${repair.id}">
          <p class="repair-description">${escapeHtml(repair.description)}</p>
          <label>
            Comments (optional)
            <textarea class="complete-comment-textarea" rows="2"></textarea>
          </label>
          <div class="edit-actions">
            <button type="button" class="save-complete-button" data-id="${repair.id}">Save</button>
            <button type="button" class="link-button cancel-complete-button" data-id="${repair.id}">
              Cancel
            </button>
          </div>
        </li>
      `;
    }

    // Description, the completion tick, and the optional comment are the
    // repair's actual content, so they stay visible by default. Added/
    // Edited/Completed date-time + username are audit metadata — moved
    // behind the Information panel instead of cluttering every row.
    const statusSlot = repair.completed_at
      ? '<p class="repair-status repair-status-completed">✓ Repair completed</p>'
      : '<span class="repair-status repair-status-todo">To do</span>';

    const commentBlock =
      repair.completed_at && repair.completed_comment
        ? `<p class="repair-comment">${escapeHtml(repair.completed_comment)}</p>`
        : '';

    return `
      <li class="repair-item" data-id="${repair.id}">
        <div class="repair-item-top">
          <p class="repair-description">${escapeHtml(repair.description)}</p>
          ${statusSlot}
        </div>
        ${commentBlock}
        <div class="repair-item-actions">
          <button type="button" class="link-button edit-repair-button" data-id="${repair.id}">
            Edit
          </button>
          <button
            type="button"
            class="link-button repair-info-button"
            data-id="${repair.id}"
            aria-expanded="${repair.id === infoRepairId}"
          >
            ${INFO_ICON_SVG} Information
          </button>
          ${
            !repair.completed_at
              ? `
            <button type="button" class="link-button mark-completed-button" data-id="${repair.id}">
              Mark as complete
            </button>
          `
              : ''
          }
        </div>
      </li>
    `;
  }

  function renderInfoPanel() {
    const repair = repairs.find((r) => r.id === infoRepairId);
    if (!repair) return '';

    return `
      <div class="repair-info-panel" id="repair-info-panel">
        <div class="repair-info-header">
          <h3>Repair history</h3>
          <button type="button" class="repair-icon-button" id="close-info-panel" aria-label="Close">
            ${CLOSE_ICON_SVG}
          </button>
        </div>
        <p class="asset-meta">
          Added by ${escapeHtml(repair.created_by_email)} · ${new Date(repair.reported_at).toLocaleString()}
        </p>
        ${
          repair.updated_at
            ? `
          <p class="asset-meta">
            Edited by ${escapeHtml(repair.updated_by_email)} · ${new Date(repair.updated_at).toLocaleString()}
          </p>
        `
            : ''
        }
        ${
          repair.completed_at
            ? `
          <p class="asset-meta">
            Completed by ${escapeHtml(repair.completed_by_email)} · ${new Date(repair.completed_at).toLocaleString()}
          </p>
        `
            : ''
        }
      </div>
    `;
  }

  function drawView() {
    body.innerHTML = `
      <article class="asset-detail">
        ${photoUrl ? `<img src="${photoUrl}" alt="Asset photo" class="asset-detail-photo" />` : ''}
        <dl>
          <dt>Asset ID</dt>
          <dd>${formatAssetId(asset.asset_number)}</dd>
          <dt>Asset name</dt>
          <dd>${escapeHtml(asset.asset_name)}</dd>
          <dt>Description</dt>
          <dd>${escapeHtml(asset.description)}</dd>
          <dt>Date/time</dt>
          <dd>${new Date(asset.recorded_at).toLocaleString()}</dd>
        </dl>
        <p class="form-error" id="delete-error" role="alert" hidden></p>
        <div class="edit-actions">
          <button type="button" id="edit-button">Edit</button>
          <button type="button" id="delete-asset-button" class="button-danger">
            ${TRASH_ICON_SVG} Delete asset
          </button>
        </div>
      </article>

      <section class="repairs" id="repairs-section">
        <h2>Repairs</h2>
        ${repairsLoadError ? `<p class="form-error" role="alert">${escapeHtml(repairsLoadError)}</p>` : ''}
        <div class="repairs-layout">
          <div class="repairs-main">
            <ul class="repair-list">
              ${repairs.length ? repairs.map(renderRepairItem).join('') : '<li class="asset-list-status">No repairs logged.</li>'}
            </ul>
            <button type="button" id="new-repair-button" ${addingRepair ? 'hidden' : ''}>New repair</button>
            <div id="new-repair-form" ${addingRepair ? '' : 'hidden'}>
              <label>
                Repair description
                <textarea id="new-repair-description" rows="2"></textarea>
              </label>
              <p class="field-error" id="new-repair-error" hidden></p>
              <p class="form-error" id="repair-submit-error" role="alert" hidden></p>
              <div class="edit-actions">
                <button type="button" id="save-repair-button">Save repair</button>
                <button type="button" id="cancel-repair-button" class="link-button">Cancel</button>
              </div>
            </div>
          </div>
          ${renderInfoPanel()}
        </div>
      </section>
    `;

    body.querySelector('#edit-button').addEventListener('click', drawEditForm);
    body.querySelector('#delete-asset-button').addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        message: `Delete "${asset.asset_name}"? This will also delete its ${repairs.length} repair record${repairs.length === 1 ? '' : 's'}. This can't be undone.`,
      });
      if (!confirmed) return;

      const errorEl = body.querySelector('#delete-error');
      errorEl.hidden = true;
      const { error: deleteError } = await supabase.from('assets').delete().eq('id', asset.id);
      if (deleteError) {
        errorEl.hidden = false;
        errorEl.textContent = deleteError.message || 'Could not delete this asset.';
        return;
      }

      navigate('#/register');
    });
    wireRepairSection();
  }

  function wireRepairSection() {
    const repairsSection = body.querySelector('#repairs-section');

    for (const button of repairsSection.querySelectorAll('.repair-info-button')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = button.dataset.id;
        infoRepairId = infoRepairId === id ? null : id;
        drawView();
      });
    }

    const closeInfoButton = repairsSection.querySelector('#close-info-panel');
    if (closeInfoButton) {
      closeInfoButton.addEventListener('click', () => {
        infoRepairId = null;
        drawView();
      });
    }

    if (outsideInfoClickHandler) {
      document.removeEventListener('click', outsideInfoClickHandler);
      outsideInfoClickHandler = null;
    }
    if (infoRepairId) {
      outsideInfoClickHandler = (event) => {
        // The view may have been torn down by navigating elsewhere
        // without closing the panel first — stop listening rather than
        // act on a detached, invisible node.
        if (!body.isConnected) {
          document.removeEventListener('click', outsideInfoClickHandler);
          return;
        }
        const panel = body.querySelector('#repair-info-panel');
        if (!panel || panel.contains(event.target) || event.target.closest('.repair-info-button')) {
          return;
        }
        infoRepairId = null;
        drawView();
      };
      document.addEventListener('click', outsideInfoClickHandler);
    }

    const newRepairButton = repairsSection.querySelector('#new-repair-button');
    newRepairButton.addEventListener('click', () => {
      // Only one repair can be in "new", "edit", or "mark complete" mode
      // at a time.
      editingRepairId = null;
      markingCompleteId = null;
      addingRepair = true;
      drawView();
    });

    repairsSection.querySelector('#cancel-repair-button').addEventListener('click', () => {
      addingRepair = false;
      drawView();
    });

    repairsSection.querySelector('#save-repair-button').addEventListener('click', async () => {
      const textarea = repairsSection.querySelector('#new-repair-description');
      const errorEl = repairsSection.querySelector('#new-repair-error');
      const submitError = repairsSection.querySelector('#repair-submit-error');
      errorEl.hidden = true;
      submitError.hidden = true;

      const { valid } = validateRepairForm({ description: textarea.value });
      if (!valid) {
        errorEl.hidden = false;
        errorEl.textContent = 'Repair description is required.';
        return;
      }

      const saveButton = repairsSection.querySelector('#save-repair-button');
      saveButton.disabled = true;

      try {
        const session = await getSession();
        const repair = {
          id: crypto.randomUUID(),
          assetId: asset.id,
          description: textarea.value.trim(),
          reportedAt: new Date().toISOString(),
          completedAt: null,
          createdByEmail: session?.user?.email ?? 'Unknown',
        };
        await queueRepair(repair);
        if (navigator.onLine) {
          await syncAll();
        }

        repairs = [
          {
            id: repair.id,
            description: repair.description,
            reported_at: repair.reportedAt,
            completed_at: null,
            created_by_email: repair.createdByEmail,
          },
          ...repairs,
        ];
        addingRepair = false;
        drawView();
      } catch (err) {
        submitError.hidden = false;
        submitError.textContent = err.message || 'Could not save this repair. Try again.';
      } finally {
        saveButton.disabled = false;
      }
    });

    for (const button of repairsSection.querySelectorAll('.edit-repair-button')) {
      button.addEventListener('click', () => {
        // Only one repair can be in "new", "edit", or "mark complete"
        // mode at a time.
        addingRepair = false;
        markingCompleteId = null;
        editingRepairId = button.dataset.id;
        drawView();
      });
    }

    for (const button of repairsSection.querySelectorAll('.cancel-edit-repair-button')) {
      button.addEventListener('click', () => {
        editingRepairId = null;
        drawView();
      });
    }

    for (const button of repairsSection.querySelectorAll('.save-edit-repair-button')) {
      button.addEventListener('click', async () => {
        const repairId = button.dataset.id;
        const item = repairsSection.querySelector(`.repair-item[data-id="${repairId}"]`);
        const textarea = item.querySelector('.edit-repair-textarea');
        const errorEl = item.querySelector('.edit-repair-error');
        const { valid } = validateRepairForm({ description: textarea.value });
        if (!valid) {
          errorEl.hidden = false;
          errorEl.textContent = 'Repair description is required.';
          return;
        }

        const repair = repairs.find((r) => r.id === repairId);
        button.disabled = true;

        try {
          const session = await getSession();
          const updatedAt = new Date().toISOString();
          const updatedByEmail = session?.user?.email ?? 'Unknown';

          await queueRepair({
            id: repair.id,
            assetId: asset.id,
            description: textarea.value.trim(),
            reportedAt: repair.reported_at,
            completedAt: repair.completed_at,
            createdByEmail: repair.created_by_email,
            updatedAt,
            updatedByEmail,
            completedByEmail: repair.completed_by_email,
            completedComment: repair.completed_comment,
          });
          if (navigator.onLine) {
            await syncAll();
          }

          repair.description = textarea.value.trim();
          repair.updated_at = updatedAt;
          repair.updated_by_email = updatedByEmail;
          editingRepairId = null;
          drawView();
        } catch {
          button.disabled = false;
        }
      });
    }

    for (const button of repairsSection.querySelectorAll('.mark-completed-button')) {
      button.addEventListener('click', () => {
        // Only one repair can be in "new", "edit", or "mark complete"
        // mode at a time.
        addingRepair = false;
        editingRepairId = null;
        markingCompleteId = button.dataset.id;
        drawView();
      });
    }

    for (const button of repairsSection.querySelectorAll('.cancel-complete-button')) {
      button.addEventListener('click', () => {
        markingCompleteId = null;
        drawView();
      });
    }

    for (const button of repairsSection.querySelectorAll('.save-complete-button')) {
      button.addEventListener('click', async () => {
        const repairId = button.dataset.id;
        const item = repairsSection.querySelector(`.repair-item[data-id="${repairId}"]`);
        const textarea = item.querySelector('.complete-comment-textarea');
        const repair = repairs.find((r) => r.id === repairId);
        if (!repair) return;

        button.disabled = true;
        try {
          const session = await getSession();
          const completedAt = new Date().toISOString();
          const completedByEmail = session?.user?.email ?? 'Unknown';
          // Optional — save no comment rather than an empty string when
          // the box was left blank.
          const completedComment = textarea.value.trim() || null;

          await queueRepair({
            id: repair.id,
            assetId: asset.id,
            description: repair.description,
            reportedAt: repair.reported_at,
            completedAt,
            createdByEmail: repair.created_by_email,
            updatedAt: repair.updated_at,
            updatedByEmail: repair.updated_by_email,
            completedByEmail,
            completedComment,
          });
          if (navigator.onLine) {
            await syncAll();
          }

          repair.completed_at = completedAt;
          repair.completed_by_email = completedByEmail;
          repair.completed_comment = completedComment;
          markingCompleteId = null;
          drawView();
        } catch {
          button.disabled = false;
        }
      });
    }
  }

  function drawEditForm() {
    body.innerHTML = `
      <form id="edit-form" novalidate>
        <label>
          Asset ID
          <input type="text" value="${formatAssetId(asset.asset_number)}" disabled />
        </label>

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

        <p class="form-error" id="submit-error" role="alert" hidden></p>
        <div class="edit-actions">
          <button type="submit">Save</button>
          <button type="button" id="cancel-edit" class="link-button">Cancel</button>
        </div>
      </form>
    `;

    const form = body.querySelector('#edit-form');
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

      const { valid, errors } = validateAssetForm({ assetName, description, recordedAt });
      showFieldErrors(errors);
      if (!valid) return;

      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;

      try {
        await queueAsset({
          id: asset.id,
          assetName: assetName.trim(),
          description: description.trim(),
          recordedAt: new Date(recordedAt).toISOString(),
          photoPath: asset.photo_path,
          photo: null,
        });

        if (navigator.onLine) {
          await syncAll();
        }

        asset = {
          ...asset,
          asset_name: assetName.trim(),
          description: description.trim(),
          recorded_at: new Date(recordedAt).toISOString(),
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
