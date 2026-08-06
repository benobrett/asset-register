import { supabase, getPhotoUrls, PHOTO_BUCKET } from '../supabase.js';
import { getSession, getProfile } from '../auth.js';
import {
  validateAssetForm,
  validateRepairForm,
  photoLimitReached,
  MAX_ASSET_PHOTOS,
} from '../validation.js';
import {
  queueAsset,
  queuePhoto,
  queueRepair,
  queueRepairComment,
  getUnsyncedPhotosForAsset,
  removeQueuedPhoto,
} from '../db.js';
import { downscaleImage, buildPhotoPath } from '../camera.js';
import { syncAll } from '../sync.js';
import { formatAssetId, CONDITION_VALUES, formatCondition } from '../format.js';
import { confirmDialog } from '../confirmDialog.js';
import { openLightbox } from '../lightbox.js';

// Same bound, and the same reasoning, as register.js's QUERY_TIMEOUT_MS:
// an offline fetch can hang rather than reject, and these are awaited
// before the screen redraws.
const PHOTO_QUERY_TIMEOUT_MS = 3000;

function withPhotoQueryTimeout(promise, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), PHOTO_QUERY_TIMEOUT_MS)),
  ]);
}

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
      .select('id, asset_number, asset_name, description, recorded_at, condition, condition_note')
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
  // Removing a photo is destructive and permanent, so viewing stays a
  // safe mode: outside this, tapping a thumbnail only opens the viewer.
  // A delete control sitting on every photo all the time is a mis-tap
  // waiting to happen on a tablet.
  //
  // Its own toggle rather than being folded into the Edit form below,
  // because the two work differently: the form's changes apply on Save,
  // whereas adding or removing a photo takes effect immediately. Putting
  // deferred and immediate actions in one form invites someone to hit
  // Cancel and expect the photo back.
  let editingPhotos = false;
  let photoError = null;

  // Resolved once per asset view, not per render: drawView() re-runs on
  // every interaction (opening an edit form, expanding a comment
  // thread), and signing four URLs again each time would be a network
  // round trip for nothing.
  //
  // [{ id, url, alt }] in display order. Unsynced photos come from the
  // local blob rather than a signed URL, because there's no object in
  // Storage to sign yet - an asset captured offline and opened before it
  // syncs still shows its photos.
  // [{ id, position, url, alt, pending, storagePath }] in display order.
  // `pending` is what decides how a photo can be removed later, so it's
  // carried through rather than recomputed.
  let photos = [];
  // The server-side half, kept across reloads so a failed refresh can
  // fall back to it - see the note in loadPhotos.
  let savedPhotos = [];

  async function loadPhotos() {
    // The blob URLs belong to this list; drop them before rebuilding it
    // or every add/remove leaks one for the life of the page.
    for (const photo of photos) {
      if (photo.pending) URL.revokeObjectURL(photo.url);
    }
    photos = [];

    // Local first, and never inside the try below: these come from
    // IndexedDB, so they're available with no connection and must still
    // show when the server side can't be reached.
    let queued = [];
    try {
      queued = await getUnsyncedPhotosForAsset(params.id);
    } catch {
      // No local queue to read - carry on with whatever the server has.
    }

    try {
      // Bounded for the same reason register.js bounds its queries: an
      // offline fetch doesn't always reject, it can simply hang, and
      // this is awaited before the screen re-renders - an unbounded one
      // would leave the view frozen on its previous state.
      const savedResult = await withPhotoQueryTimeout(
        supabase
          .from('asset_photos')
          .select('id, storage_path, position')
          .eq('asset_id', params.id)
          .order('position', { ascending: true }),
        null
      );
      // null is the timeout's own marker, distinct from a query that
      // genuinely came back with no rows - which does mean "no photos".
      if (savedResult) {
        const saved = savedResult.data ?? [];
        const { urls, unavailable } = await withPhotoQueryTimeout(
          getPhotoUrls(saved.map((photo) => photo.storage_path)),
          // Offline, the timeout fires and nothing gets signed. That's a
          // connection problem, not a permission one, so don't accuse the
          // photos of being unavailable - leave both empty and let the
          // last known set below stand.
          { urls: new Map(), unavailable: [] }
        );
        const unavailablePaths = new Set(unavailable);
        // A row whose file can't be signed is kept and rendered as a
        // placeholder, not dropped. Dropping it is indistinguishable from
        // the asset having no photo, which is precisely what hid #97.
        savedPhotos = saved
          .map((photo) => ({
            id: photo.id,
            position: photo.position,
            storagePath: photo.storage_path,
            url: urls.get(photo.storage_path) ?? null,
            unavailable: unavailablePaths.has(photo.storage_path),
            pending: false,
          }))
          .filter((photo) => photo.url || photo.unavailable);
      }
    } catch {
      // Keep the last known set (below) rather than dropping them.
    }
    // Deliberately *not* cleared when the query fails. Adding a photo
    // offline re-runs this, and a synced photo can't be re-listed or
    // re-signed with no connection - clearing would make the photos
    // already on screen vanish as a side effect of adding another. The
    // signed URLs already in hand stay valid for the hour they were
    // issued for.

    // A photo that has just synced briefly exists in both - the row is
    // written before the queue entry is dropped - so the saved copy wins
    // and it isn't shown twice.
    const savedIds = new Set(savedPhotos.map((photo) => photo.id));
    const pending = queued
      .filter((photo) => !savedIds.has(photo.id))
      .map((photo) => ({
        id: photo.id,
        position: photo.position ?? 1,
        storagePath: photo.storagePath,
        url: URL.createObjectURL(photo.blob),
        pending: true,
      }));

    photos = [...savedPhotos, ...pending]
      .filter((photo) => photo.url || photo.unavailable)
      // position is a sort key with gaps in it, not an index.
      .sort((a, b) => a.position - b.position)
      .map((photo, index, all) => ({
        ...photo,
        alt: all.length > 1 ? `Asset photo ${index + 1} of ${all.length}` : 'Asset photo',
      }));
  }

  await loadPhotos();

  // Deleting a photo that has already synced means removing a database
  // row *and* a Storage object, and there's no mechanism in this app for
  // queueing that reliably - asset deletion is a direct call too, so this
  // keeps one deletion story rather than inventing a second. Hence the
  // explicit connection check, worded the way the password-reset screens
  // word theirs rather than failing with a generic network error.
  async function deleteSyncedPhoto(photo) {
    if (!navigator.onLine) {
      throw new Error('You need to be online to delete this photo.');
    }

    // Row first, then the object. The other way round, a failure between
    // the two leaves a thumbnail pointing at a file that no longer
    // exists - a visible, confusing bug on this screen. This way it
    // leaves an orphaned file: invisible, harmless in the short term,
    // and cleanable later (see CLAUDE.md).
    const { error: rowError } = await supabase.from('asset_photos').delete().eq('id', photo.id);
    if (rowError) throw rowError;

    const { error: objectError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .remove([photo.storagePath]);
    if (objectError) {
      // The row is already gone, so as far as the app is concerned the
      // photo has been removed. Nothing useful to tell the user here.
      console.error('Photo row deleted but its file could not be removed:', objectError);
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
    // The lightbox only ever gets photos it can actually display, so its
    // indices are into this list rather than `photos` - an unavailable
    // tile isn't clickable and must not occupy a slot in the viewer.
    const viewablePhotos = photos.filter((photo) => !photo.unavailable);

    body.innerHTML = `
      <article class="asset-detail">
        <!-- Fields first in the DOM, photos second, so they read in that
             order for a screen reader and stack that way on a narrow
             screen. The side-by-side arrangement is purely CSS. -->
        <div class="asset-detail-layout">
          <dl>
            <dt>Asset ID</dt>
            <dd>${formatAssetId(asset.asset_number)}</dd>
            <dt>Asset name</dt>
            <dd>${escapeHtml(asset.asset_name)}</dd>
            <dt>Description</dt>
            <dd>${escapeHtml(asset.description)}</dd>
            <dt>Date/time</dt>
            <dd>${new Date(asset.recorded_at).toLocaleString()}</dd>
            <dt>Condition</dt>
            <dd>${formatCondition(asset.condition) ?? 'Not set'}</dd>
            <dt>Condition note</dt>
            <dd>${asset.condition_note ? escapeHtml(asset.condition_note) : '—'}</dd>
          </dl>
          <div class="asset-detail-photo-panel">
            ${
              photos.length
                ? `<ul class="photo-grid asset-detail-photos">
                    ${photos
                      .map(
                        (photo) => `
                      <li class="photo-grid-item">
                        ${
                          photo.unavailable
                            ? // Deliberately occupies the tile rather than
                              // disappearing: a photo the register still
                              // has a row for is not the same as no photo,
                              // and only one of those is worth reporting.
                              `<div class="photo-thumb photo-thumb-unavailable" role="img"
                                    aria-label="Photo unavailable">
                                 <span aria-hidden="true">⚠</span>
                                 <span class="photo-unavailable-text">Photo unavailable</span>
                               </div>`
                            : `<button
                          type="button"
                          class="photo-thumb-button"
                          data-photo-index="${viewablePhotos.indexOf(photo)}"
                          aria-label="View ${escapeHtml(photo.alt)}"
                          ${editingPhotos ? 'disabled' : ''}
                        >
                          <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt)}" class="photo-thumb" />
                        </button>`
                        }
                        ${
                          editingPhotos
                            ? `<button
                                 type="button"
                                 class="link-button remove-photo-button"
                                 data-photo-id="${escapeHtml(photo.id)}"
                               >Remove</button>`
                            : ''
                        }
                      </li>
                    `
                      )
                      .join('')}
                  </ul>`
                : '<p class="asset-meta">No photos yet.</p>'
            }
            ${photoError ? `<p class="form-error" role="alert">${escapeHtml(photoError)}</p>` : ''}
            <div class="edit-actions photo-panel-actions">
              <button type="button" class="link-button" id="toggle-photo-edit">
                ${editingPhotos ? 'Done' : 'Edit photos'}
              </button>
              ${
                editingPhotos
                  ? `<input type="file" id="detail-photo-input" accept="image/*" capture="environment" hidden />
                     <button type="button" id="detail-add-photo" ${photoLimitReached(photos.length) ? 'disabled' : ''}>
                       Add photo
                     </button>`
                  : ''
              }
            </div>
            ${
              editingPhotos && photoLimitReached(photos.length)
                ? `<p class="asset-meta">Maximum of ${MAX_ASSET_PHOTOS} photos. Remove one to add another.</p>`
                : ''
            }
          </div>
        </div>
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

    // Re-wired on every drawView, like everything else here - the whole
    // template is rewritten each time, so these are fresh nodes.
    for (const button of body.querySelectorAll('.photo-thumb-button')) {
      button.addEventListener('click', () => {
        openLightbox({
          photos: viewablePhotos,
          startIndex: Number(button.dataset.photoIndex),
          // Focus returns to the thumbnail that opened it. Safe across a
          // re-render: the overlay doesn't trigger one, so this node is
          // still in the document when it closes.
          returnFocusTo: button,
        });
      });
    }

    body.querySelector('#toggle-photo-edit').addEventListener('click', () => {
      editingPhotos = !editingPhotos;
      photoError = null;
      drawView();
    });

    const detailPhotoInput = body.querySelector('#detail-photo-input');
    body.querySelector('#detail-add-photo')?.addEventListener('click', () => {
      detailPhotoInput.click();
    });

    detailPhotoInput?.addEventListener('change', async () => {
      const file = detailPhotoInput.files[0];
      // Cleared before any await, same as the capture form: choosing the
      // same file twice otherwise fires no change event at all.
      detailPhotoInput.value = '';
      if (!file || photoLimitReached(photos.length)) return;

      photoError = null;
      try {
        const session = await getSession();
        const blob = await downscaleImage(file);
        // max + 1, not length + 1: positions have gaps in them once a
        // photo has been removed, so counting would collide with one.
        const nextPosition = photos.length
          ? Math.max(...photos.map((photo) => photo.position)) + 1
          : 1;

        // Queued, never written straight to Supabase - adding a photo is
        // the same act as capturing one, and has to work standing in
        // front of the asset with no signal.
        const photoId = crypto.randomUUID();
        await queuePhoto({
          id: photoId,
          assetId: asset.id,
          storagePath: buildPhotoPath(session.user.id),
          position: nextPosition,
          blob,
        });

        if (navigator.onLine) {
          // syncAll's failures used to be discarded here, and that is what
          // made issue #97 invisible: with no Storage policy every upload
          // 403'd, the photo stayed queued, and this screen rendered it
          // from its local blob - so it looked perfect to the person who
          // took it and didn't exist for anyone else.
          //
          // Failing while *offline* is normal and stays silent; the queue
          // exists for exactly that. Failing while online is not, and the
          // queue will retry it forever without ever saying so.
          const result = await syncAll();
          if (result.photos.failed.some((failure) => failure.id === photoId)) {
            photoError =
              'Saved on this device, but the upload failed, so other people can’t see this photo yet. It will retry — if it keeps happening, report it.';
          }
        }
      } catch (err) {
        photoError = err.message || 'Could not add this photo. Try again.';
      }

      await loadPhotos();
      drawView();
    });

    for (const button of body.querySelectorAll('.remove-photo-button')) {
      button.addEventListener('click', async () => {
        const photo = photos.find((candidate) => candidate.id === button.dataset.photoId);
        if (!photo) return;

        // Worded harder than the capture form's equivalent: there, the
        // photo was taken seconds ago. Here it may be the only record of
        // how this asset looked months back.
        const confirmed = await confirmDialog({
          message: photo.pending
            ? 'Remove this photo? It has not been uploaded yet, so it will be discarded.'
            : 'Permanently delete this photo? This cannot be undone.',
          confirmLabel: 'Delete',
        });
        if (!confirmed) return;

        photoError = null;
        try {
          if (photo.pending) {
            // Nothing on the server to undo - just drop it out of the
            // local queue, which works with no connection at all.
            await removeQueuedPhoto(photo.id);
          } else {
            await deleteSyncedPhoto(photo);
          }
        } catch (err) {
          // Nothing changed, so there's nothing to re-read - and going
          // to the network here would make the user wait out a timeout
          // before being told why the last attempt didn't work.
          photoError = err.message || 'Could not remove this photo. Try again.';
          drawView();
          return;
        }

        await loadPhotos();
        drawView();
      });
    }

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

        <!-- Explicit for/id, not a wrapping label like the other fields
             here - a <select>'s accessible name, when wrapped, otherwise
             concatenates every <option>'s own text alongside the label
             text, making it unmatchable by its plain label text alone. -->
        <label for="condition-select">Condition</label>
        <select id="condition-select" name="condition">
          <option value="" ${!asset.condition ? 'selected' : ''}>Not set</option>
          ${CONDITION_VALUES.map(
            (value) =>
              `<option value="${value}" ${asset.condition === value ? 'selected' : ''}>${formatCondition(value)}</option>`
          ).join('')}
        </select>
        <p class="field-error" data-error-for="condition" hidden></p>

        <label>
          Condition note
          <input type="text" name="conditionNote" maxlength="200" value="${escapeHtml(asset.condition_note ?? '')}" />
        </label>
        <p class="field-error" data-error-for="conditionNote" hidden></p>

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
        await queueAsset({
          id: asset.id,
          assetName: assetName.trim(),
          description: description.trim(),
          recordedAt: new Date(recordedAt).toISOString(),
          photo: null,
          condition,
          conditionNote,
        });

        if (navigator.onLine) {
          await syncAll();
        }

        asset = {
          ...asset,
          asset_name: assetName.trim(),
          description: description.trim(),
          recorded_at: new Date(recordedAt).toISOString(),
          condition,
          condition_note: conditionNote,
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
