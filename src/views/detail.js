import { supabase, getPhotoUrl } from '../supabase.js';
import { getSession, getProfile } from '../auth.js';
import { validateAssetForm, validateRepairForm } from '../validation.js';
import { queueAsset, queueRepair, queueRepairComment } from '../db.js';
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

const COMMENT_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
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

// Falls back to the email address for a comment left before its author
// had a name on file (or whose account still doesn't have one).
function getCommentAuthor(comment) {
  return comment.created_by_name || comment.created_by_email;
}

// Comments show date only, no time — e.g. "26 July 26".
function formatCommentDate(isoString) {
  const date = new Date(isoString);
  const day = date.getDate();
  const month = date.toLocaleString('en-NZ', { month: 'long' });
  const year = String(date.getFullYear()).slice(-2);
  return `${day} ${month} ${year}`;
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

  const [assetResult, repairsResult, currentUserProfile] = await Promise.all([
    supabase
      .from('assets')
      .select('id, asset_number, asset_name, description, recorded_at, photo_path')
      .eq('id', params.id)
      .single(),
    supabase
      .from('asset_repairs')
      .select(
        'id, description, reported_at, completed_at, created_by_email, updated_at, updated_by_email, completed_by_email'
      )
      .eq('asset_id', params.id)
      .order('reported_at', { ascending: false }),
    // Needed to stamp any comment added in this session with a display
    // name - fetched once up front rather than per-comment.
    getProfile().catch(() => null),
  ]);

  // Falls back to null (not the email) here - the email fallback only
  // applies once a comment is actually being rendered, where the specific
  // comment's own created_by_email is what's available to fall back to.
  const currentUserName =
    currentUserProfile?.first_name && currentUserProfile?.last_name
      ? `${currentUserProfile.first_name} ${currentUserProfile.last_name}`
      : null;

  const body = container.querySelector('#detail-body');

  if (assetResult.error || !assetResult.data) {
    body.innerHTML = `<p>${escapeHtml(assetResult.error?.message || 'Asset not found.')}</p>`;
    return;
  }

  let asset = assetResult.data;
  let repairs = repairsResult.data || [];
  let repairsLoadError = repairsResult.error?.message || null;

  // Keyed by repair id, each value an array of { comment, created_by_email,
  // created_by_name, created_at } oldest-first — the panel shows the whole
  // array, the inline preview shows just its last entry.
  const commentsByRepairId = new Map();
  if (repairs.length) {
    const { data: comments, error: commentsError } = await supabase
      .from('repair_comments')
      .select('id, repair_id, comment, created_by_email, created_by_name, created_at')
      .in(
        'repair_id',
        repairs.map((r) => r.id)
      )
      .order('created_at', { ascending: true });
    if (!commentsError) {
      for (const comment of comments || []) {
        const list = commentsByRepairId.get(comment.repair_id) || [];
        list.push(comment);
        commentsByRepairId.set(comment.repair_id, list);
      }
    }
  }

  let editingRepairId = null;
  let addingRepair = false;
  let markingCompleteId = null;
  // Comment expands the repair item in place and joins the "one editing
  // action at a time" group (it saves new data) — opening it cancels any
  // of the above, and vice versa. Information stays exempt (view-only),
  // opens in its own right-hand panel, and can stay open alongside an
  // expanded Comment section.
  let commentRepairId = null;
  // Tracks commentRepairId as of the last paint, so the expand/collapse
  // transition has a real "from" state to animate from even though the
  // whole section is torn down and rebuilt on every drawView() call.
  let previousCommentRepairId = null;
  let infoRepairId = null;
  let outsideInfoClickHandler = null;
  let repairSortKey = 'newest';

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

    const isCommentExpanded = repair.id === commentRepairId;
    const wasCommentExpanded = repair.id === previousCommentRepairId;

    const repairComments = commentsByRepairId.get(repair.id) || [];
    const latestComment = repairComments[repairComments.length - 1];
    // Redundant once expanded — the same comment is the last entry in the
    // full thread below, so the preview line is hidden while open.
    const commentBlock =
      latestComment && !isCommentExpanded
        ? `
      <p class="repair-comment-preview">
        ${escapeHtml(latestComment.comment)}
        <span class="asset-meta">— ${escapeHtml(getCommentAuthor(latestComment))} · ${formatCommentDate(latestComment.created_at)}</span>
      </p>
    `
        : '';

    const infoOpenForThis = repair.id === infoRepairId;

    return `
      <li class="repair-item ${infoOpenForThis ? 'repair-item-panel-open' : ''}" data-id="${repair.id}">
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
            aria-expanded="${infoOpenForThis}"
          >
            ${INFO_ICON_SVG} Information
          </button>
          <button
            type="button"
            class="link-button repair-comment-button"
            data-id="${repair.id}"
            aria-expanded="${isCommentExpanded}"
          >
            ${COMMENT_ICON_SVG} Comment
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
        <div class="repair-comment-expand ${wasCommentExpanded ? 'is-open' : ''}" data-repair-id="${repair.id}">
          <div class="repair-comment-expand-inner">
            ${renderCommentExpandBody(repair)}
          </div>
        </div>
      </li>
    `;
  }

  // `repairs` is already newest-first by reported_at (the initial query's
  // order, preserved since new repairs are unshifted to the front and
  // later mutations only change fields, never reorder) — so filtering
  // here is enough, no separate sort step needed.
  function getFilteredRepairs() {
    if (repairSortKey === 'todo') return repairs.filter((r) => !r.completed_at);
    if (repairSortKey === 'complete') return repairs.filter((r) => r.completed_at);
    return repairs;
  }

  function getRepairsEmptyMessage() {
    if (repairSortKey === 'todo') return 'No repairs to do.';
    if (repairSortKey === 'complete') return 'No completed repairs found.';
    return 'No repairs logged.';
  }

  function renderInfoPanelBody(repair) {
    return `
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
    `;
  }

  // Always rendered (content included regardless of expanded state) so the
  // grid-row expand/collapse transition has something to reveal — visibility
  // is purely a CSS concern (.repair-comment-expand's grid-template-rows),
  // not a matter of whether this markup exists.
  function renderCommentExpandBody(repair) {
    const comments = commentsByRepairId.get(repair.id) || [];
    const thread = comments.length
      ? `
      <ul class="comment-thread">
        ${comments
          .map(
            (comment) => `
          <li class="comment-thread-item">
            <p class="comment-text">${escapeHtml(comment.comment)}</p>
            <p class="asset-meta">
              ${escapeHtml(getCommentAuthor(comment))} · ${formatCommentDate(comment.created_at)}
            </p>
          </li>
        `
          )
          .join('')}
      </ul>
    `
      : '';

    return `
      <div class="repair-comment-expand-header">
        <h3>Comments</h3>
        <button
          type="button"
          class="repair-icon-button collapse-comment-button"
          data-id="${repair.id}"
          aria-label="Close"
        >
          ${CLOSE_ICON_SVG}
        </button>
      </div>
      ${thread}
      <label>
        Add a comment
        <textarea class="new-comment-textarea" rows="2"></textarea>
      </label>
      <p class="form-error comment-submit-error" role="alert" hidden></p>
      <div class="edit-actions">
        <button type="button" class="save-comment-button" data-id="${repair.id}">Save</button>
        <button type="button" class="link-button collapse-comment-button" data-id="${repair.id}">
          Close
        </button>
      </div>
    `;
  }

  function renderInfoPanel() {
    if (!infoRepairId) return '';
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
        ${renderInfoPanelBody(repair)}
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
        <div class="view-header repairs-header">
          <h2>Repairs</h2>
          <button type="button" id="new-repair-button" ${addingRepair ? 'hidden' : ''}>New repair</button>
        </div>
        ${repairsLoadError ? `<p class="form-error" role="alert">${escapeHtml(repairsLoadError)}</p>` : ''}
        <label class="sort-label">
          Sort by
          <select id="repair-sort-select">
            <option value="newest" ${repairSortKey === 'newest' ? 'selected' : ''}>Newest</option>
            <option value="todo" ${repairSortKey === 'todo' ? 'selected' : ''}>To do</option>
            <option value="complete" ${repairSortKey === 'complete' ? 'selected' : ''}>Repair Complete</option>
          </select>
        </label>
        <div class="repairs-layout">
          <div class="repairs-main">
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
            <ul class="repair-list">
              ${
                getFilteredRepairs().length
                  ? getFilteredRepairs().map(renderRepairItem).join('')
                  : `<li class="asset-list-status">${getRepairsEmptyMessage()}</li>`
              }
            </ul>
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

    repairsSection.querySelector('#repair-sort-select').addEventListener('change', (event) => {
      repairSortKey = event.target.value;
      drawView();
    });

    for (const button of repairsSection.querySelectorAll('.repair-info-button')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = button.dataset.id;
        // Exempt from the "one editing action at a time" group (view-only)
        // and independent of Comment — can stay open alongside it.
        infoRepairId = infoRepairId === id ? null : id;
        drawView();
      });
    }

    for (const button of repairsSection.querySelectorAll('.repair-comment-button')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = button.dataset.id;
        if (commentRepairId === id) {
          commentRepairId = null;
        } else {
          // Unlike Information, Comment saves new data, so it joins the
          // "one editing action at a time" group.
          addingRepair = false;
          editingRepairId = null;
          markingCompleteId = null;
          commentRepairId = id;
        }
        drawView();
      });
    }

    for (const button of repairsSection.querySelectorAll('.collapse-comment-button')) {
      button.addEventListener('click', () => {
        commentRepairId = null;
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

    // The expand/collapse transition needs a real "from" state to animate
    // from on the next render — see previousCommentRepairId's declaration.
    requestAnimationFrame(() => {
      for (const el of repairsSection.querySelectorAll('.repair-comment-expand')) {
        el.classList.toggle('is-open', el.dataset.repairId === commentRepairId);
      }
      previousCommentRepairId = commentRepairId;
    });

    const newRepairButton = repairsSection.querySelector('#new-repair-button');
    newRepairButton.addEventListener('click', () => {
      // Only one repair can be in "new", "edit", "mark complete", or
      // "comment" mode at a time.
      editingRepairId = null;
      markingCompleteId = null;
      commentRepairId = null;
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
        // Only one repair can be in "new", "edit", "mark complete", or
        // "comment" mode at a time.
        addingRepair = false;
        markingCompleteId = null;
        commentRepairId = null;
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
        // Only one repair can be in "new", "edit", "mark complete", or
        // "comment" mode at a time.
        addingRepair = false;
        editingRepairId = null;
        commentRepairId = null;
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
          // Optional — the completion comment, if entered, becomes this
          // repair's first (or next) thread entry rather than its own field.
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
          });

          if (completedComment) {
            await queueRepairComment({
              id: crypto.randomUUID(),
              repairId: repair.id,
              comment: completedComment,
              createdByEmail: completedByEmail,
              createdByName: currentUserName,
              createdAt: completedAt,
            });
          }

          if (navigator.onLine) {
            await syncAll();
          }

          repair.completed_at = completedAt;
          repair.completed_by_email = completedByEmail;
          if (completedComment) {
            const list = commentsByRepairId.get(repair.id) || [];
            list.push({
              comment: completedComment,
              created_by_email: completedByEmail,
              created_by_name: currentUserName,
              created_at: completedAt,
            });
            commentsByRepairId.set(repair.id, list);
          }
          markingCompleteId = null;
          drawView();
        } catch {
          button.disabled = false;
        }
      });
    }

    for (const button of repairsSection.querySelectorAll('.save-comment-button')) {
      button.addEventListener('click', async () => {
        const repairId = button.dataset.id;
        const item = repairsSection.querySelector(`.repair-item[data-id="${repairId}"]`);
        const textarea = item.querySelector('.new-comment-textarea');
        const errorEl = item.querySelector('.comment-submit-error');
        const text = textarea.value.trim();
        if (!text) return;

        errorEl.hidden = true;
        button.disabled = true;
        try {
          const session = await getSession();
          const createdByEmail = session?.user?.email ?? 'Unknown';
          const createdAt = new Date().toISOString();

          await queueRepairComment({
            id: crypto.randomUUID(),
            repairId,
            comment: text,
            createdByEmail,
            createdByName: currentUserName,
            createdAt,
          });
          if (navigator.onLine) {
            await syncAll();
          }

          const list = commentsByRepairId.get(repairId) || [];
          list.push({
            comment: text,
            created_by_email: createdByEmail,
            created_by_name: currentUserName,
            created_at: createdAt,
          });
          commentsByRepairId.set(repairId, list);
          // Stays expanded — commentRepairId is untouched — and the fresh
          // markup naturally clears the textarea.
          drawView();
        } catch (err) {
          errorEl.hidden = false;
          errorEl.textContent = err.message || 'Could not save this comment. Try again.';
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
