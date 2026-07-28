import { supabase } from '../supabase.js';
import { formatAssetId, formatCondition } from '../format.js';
import { confirmDialog } from '../confirmDialog.js';
import { getUnsyncedAssets } from '../db.js';

const SORT_STORAGE_KEY = 'assetSort';

// Offline, a fetch doesn't always fail cleanly and quickly - it can hang
// with no response at all rather than rejecting. Without a bound on it,
// this view would just sit on "Loading…" forever instead of ever reaching
// the fallback below that shows this device's queued assets - exactly the
// case #60 exists to handle.
const QUERY_TIMEOUT_MS = 3000;

function withTimeout(promise, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), QUERY_TIMEOUT_MS)),
  ]);
}

const SORT_OPTIONS = {
  newest: { column: 'recorded_at', ascending: false },
  oldest: { column: 'recorded_at', ascending: true },
  'name-asc': { column: 'asset_name', ascending: true },
  'name-desc': { column: 'asset_name', ascending: false },
  // Not a pure re-order like the others — also filters out assets with
  // no repair records at all.
  repairs: { column: 'asset_name', ascending: true, repairsOnly: true },
};

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

export function renderRegister(container, { navigate }) {
  container.innerHTML = `
    <section class="view view-register">
      <header class="view-header">
        <h1>Assets</h1>
      </header>
      <div class="register-actions">
        <button type="button" id="add-asset-button">Add New Asset</button>
      </div>
      <p class="register-intro">Below is a list of all the assets for the Brook Waimārama Sanctuary.</p>
      <input type="search" id="search" placeholder="Search assets…" />
      <label class="sort-label">
        Sort by
        <select id="sort-select">
          <option value="repairs">Repairs</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name-asc">Name (A–Z)</option>
          <option value="name-desc">Name (Z–A)</option>
        </select>
      </label>
      <p class="form-error" id="list-error" role="alert" hidden></p>
      <ul class="asset-list" id="asset-list"></ul>
      <div class="asset-table-wrapper">
        <table class="asset-table" id="asset-table">
          <thead>
            <tr>
              <th>Asset ID</th>
              <th>Name</th>
              <th>Description</th>
              <th>Condition</th>
              <th>Status</th>
              <th>Repairs</th>
            </tr>
          </thead>
          <tbody id="asset-table-body"></tbody>
        </table>
      </div>
    </section>
  `;

  container.querySelector('#add-asset-button').addEventListener('click', () => navigate('#/capture'));

  const listEl = container.querySelector('#asset-list');
  const tableBodyEl = container.querySelector('#asset-table-body');
  const errorEl = container.querySelector('#list-error');
  const searchInput = container.querySelector('#search');
  const sortSelect = container.querySelector('#sort-select');

  // Persists for the browser tab/session (sessionStorage clears itself
  // when the tab or browser closes) - not on the option order in the
  // markup, which no longer matches "Newest first" now that "Repairs"
  // is listed first.
  const storedSort = sessionStorage.getItem(SORT_STORAGE_KEY);
  sortSelect.value = storedSort && SORT_OPTIONS[storedSort] ? storedSort : 'newest';

  // A queued-but-not-yet-synced asset (db.js's shape: assetName/
  // description/recordedAt, camelCase) rather than a live one (Postgres's
  // asset_name/description/recorded_at). No asset_number yet - that's a
  // Postgres identity column, assigned only once the row actually
  // exists server-side - and no repair data, since asset_repairs is a
  // live-only query too. Not clickable and has no delete button: this
  // isn't a real row yet, so there's nowhere to navigate to and no
  // matching server-side record to delete.
  function appendPendingItem(asset) {
    const item = document.createElement('li');
    item.className = 'asset-list-item';
    item.innerHTML = `
      <span class="asset-list-button is-pending" aria-disabled="true">
        <span class="asset-list-text">
          <span class="asset-name">${escapeHtml(asset.assetName)}</span>
          <span class="asset-meta">Not yet synced</span>
          ${renderConditionBadge(asset.condition)}
        </span>
        <span class="repair-tag">⏳ Syncing…</span>
      </span>
    `;
    listEl.appendChild(item);

    const row = document.createElement('tr');
    row.className = 'asset-table-row';
    row.innerHTML = `
      <td>—</td>
      <td>${escapeHtml(asset.assetName)}</td>
      <td class="asset-table-description">${escapeHtml(asset.description)}</td>
      ${renderConditionCell(asset.condition)}
      <td><span class="repair-tag">⏳ Syncing…</span></td>
      <td>—</td>
    `;
    tableBodyEl.appendChild(row);
  }

  async function loadAssets(searchTerm, sortKey) {
    listEl.innerHTML = '<li class="asset-list-status">Loading…</li>';
    tableBodyEl.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
    errorEl.hidden = true;
    errorEl.classList.remove('form-notice');

    const sort = SORT_OPTIONS[sortKey];
    // condition_note is deliberately not selected - the register is a
    // scanning view, and free text has no place in a dense list/table.
    let query = supabase
      .from('assets')
      .select('id, asset_number, asset_name, description, recorded_at, condition')
      .order(sort.column, { ascending: sort.ascending });

    if (searchTerm) {
      query = query.or(`asset_name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
    }

    // Fetched unconditionally (cheap, local-only, no network) so a
    // just-saved asset doesn't just disappear until it syncs - both
    // while genuinely offline (see below) and in the brief online window
    // between queuing and sync.js actually uploading it.
    const [{ data, error }, repairsResult, queuedAssets] = await Promise.all([
      withTimeout(query, { data: null, error: new Error('Request timed out.') }),
      // A plain query rather than embedding assets->asset_repairs via
      // PostgREST's relationship syntax — that relies on its schema
      // cache recognizing the foreign key, which proved unreliable.
      // Fetches every repair (not just outstanding ones) since the
      // delete-confirmation message needs a total count per asset too.
      withTimeout(supabase.from('asset_repairs').select('asset_id, completed_at'), { data: [] }),
      getUnsyncedAssets(),
    ]);

    if (error) {
      // Offline (or otherwise unreachable) - show whatever's queued on
      // this device rather than nothing but an error banner. Necessarily
      // partial: only this device's own not-yet-synced assets, no repair
      // data (that's a live-only query too), no server-side sort.
      const pending = queuedAssets.filter((asset) =>
        matchesSearch(asset.assetName, asset.description, searchTerm)
      );
      if (!pending.length) {
        listEl.innerHTML = '';
        tableBodyEl.innerHTML = '';
        errorEl.hidden = false;
        errorEl.textContent = error.message || 'Could not load assets.';
        return;
      }

      // Real information, not a failure - the save genuinely worked and
      // is sitting safely queued, so this reads as a notice, not an
      // error (same softened treatment login.js uses for its own
      // non-error alert).
      errorEl.hidden = false;
      errorEl.classList.add('form-notice');
      errorEl.textContent =
        "Showing assets saved on this device only — reconnect to see the full register.";
      listEl.innerHTML = '';
      tableBodyEl.innerHTML = '';
      // Newest first - the same default sort a fresh register load uses,
      // since there's no server-side ordering to fall back on here.
      for (const asset of [...pending].sort((a, b) =>
        b.recordedAt.localeCompare(a.recordedAt)
      )) {
        appendPendingItem(asset);
      }
      return;
    }

    const outstandingCounts = new Map();
    const totalCounts = new Map();
    for (const repair of repairsResult.data || []) {
      totalCounts.set(repair.asset_id, (totalCounts.get(repair.asset_id) ?? 0) + 1);
      if (!repair.completed_at) {
        outstandingCounts.set(repair.asset_id, (outstandingCounts.get(repair.asset_id) ?? 0) + 1);
      }
    }

    // Once every repair on an asset is marked completed it drops out —
    // same rule as the row highlight, based on outstanding repairs only,
    // not whether one was ever logged.
    const displayData = sort.repairsOnly
      ? data.filter((asset) => (outstandingCounts.get(asset.id) ?? 0) > 0)
      : data;

    // Anything still queued that the live query doesn't know about yet -
    // a brief window right after saving, before sync.js's upload
    // finishes. A repairs-only sort never includes these: a
    // just-created asset has no repairs yet by definition.
    const syncedIds = new Set(data.map((asset) => asset.id));
    const pendingOnly = sort.repairsOnly
      ? []
      : queuedAssets
          .filter((asset) => !syncedIds.has(asset.id))
          .filter((asset) => matchesSearch(asset.assetName, asset.description, searchTerm));

    if (!displayData.length && !pendingOnly.length) {
      const emptyMessage = sort.repairsOnly ? 'No assets with repairs found.' : 'No assets found.';
      listEl.innerHTML = `<li class="asset-list-status">${emptyMessage}</li>`;
      tableBodyEl.innerHTML = `<tr><td colspan="6">${emptyMessage}</td></tr>`;
      return;
    }

    listEl.innerHTML = '';
    tableBodyEl.innerHTML = '';
    for (const asset of pendingOnly) {
      appendPendingItem(asset);
    }
    for (const asset of displayData) {
      const outstandingCount = outstandingCounts.get(asset.id) ?? 0;
      const totalCount = totalCounts.get(asset.id) ?? 0;
      const hasOutstandingRepair = outstandingCount > 0;

      async function handleDelete(event, rowEl) {
        event.stopPropagation();

        const confirmed = await confirmDialog({
          message: `Delete "${asset.asset_name}"? This will also delete its ${totalCount} repair record${totalCount === 1 ? '' : 's'}. This can't be undone.`,
        });
        if (!confirmed) return;

        errorEl.hidden = true;
        const { error: deleteError } = await supabase.from('assets').delete().eq('id', asset.id);
        if (deleteError) {
          errorEl.hidden = false;
          errorEl.textContent = deleteError.message || 'Could not delete this asset.';
          return;
        }

        rowEl.remove();
        if (!listEl.children.length) {
          const emptyMessage = sort.repairsOnly
            ? 'No assets with repairs found.'
            : 'No assets found.';
          listEl.innerHTML = `<li class="asset-list-status">${emptyMessage}</li>`;
        }
      }

      const item = document.createElement('li');
      item.className = 'asset-list-item';
      item.innerHTML = `
        <button
          type="button"
          class="asset-list-button ${hasOutstandingRepair ? 'has-repair' : ''}"
          data-id="${asset.id}"
        >
          <span class="asset-list-text">
            <span class="asset-name">${escapeHtml(asset.asset_name)}</span>
            <span class="asset-meta">${formatAssetId(asset.asset_number)}</span>
            ${renderConditionBadge(asset.condition)}
          </span>
          ${hasOutstandingRepair ? '<span class="repair-tag">🔧 Repair logged</span>' : ''}
        </button>
        <button
          type="button"
          class="delete-asset-button"
          data-id="${asset.id}"
          aria-label="Delete ${escapeHtml(asset.asset_name)}"
        >
          ${TRASH_ICON_SVG}
        </button>
      `;
      item.querySelector('.asset-list-button').addEventListener('click', () => {
        navigate(`#/asset/${asset.id}`);
      });
      item
        .querySelector('.delete-asset-button')
        .addEventListener('click', (event) => handleDelete(event, item));
      listEl.appendChild(item);

      const row = document.createElement('tr');
      row.className = `asset-table-row ${hasOutstandingRepair ? 'has-repair' : ''}`;
      row.tabIndex = 0;
      row.innerHTML = `
        <td>${formatAssetId(asset.asset_number)}</td>
        <td>${escapeHtml(asset.asset_name)}</td>
        <td class="asset-table-description">${escapeHtml(asset.description)}</td>
        ${renderConditionCell(asset.condition)}
        <td>${hasOutstandingRepair ? '<span class="repair-tag">🔧 To do</span>' : 'OK'}</td>
        <td>${outstandingCount}</td>
      `;
      row.addEventListener('click', () => navigate(`#/asset/${asset.id}`));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate(`#/asset/${asset.id}`);
        }
      });
      tableBodyEl.appendChild(row);
    }
  }

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(
      () => loadAssets(searchInput.value.trim(), sortSelect.value),
      250
    );
  });

  sortSelect.addEventListener('change', () => {
    sessionStorage.setItem(SORT_STORAGE_KEY, sortSelect.value);
    loadAssets(searchInput.value.trim(), sortSelect.value);
  });

  loadAssets('', sortSelect.value);
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

// Table cell - always renders something, even when unset, so an unset
// condition reads as "not recorded yet" rather than a blank cell that
// looks like a rendering bug.
function renderConditionCell(condition) {
  const label = formatCondition(condition);
  if (!label) return '<td>—</td>';
  return `<td><span class="condition-tag condition-${condition}">${label}</span></td>`;
}

// Card badge - omitted entirely when unset, matching how the repair-tag
// badge on this same card only appears when there's something to say.
function renderConditionBadge(condition) {
  const label = formatCondition(condition);
  if (!label) return '';
  return `<span class="condition-tag condition-${condition}">${label}</span>`;
}

// A queued asset never went through the server-side ilike search the
// live query uses, so it needs an equivalent client-side check to stay
// in or out of the list consistently with whatever's currently typed.
function matchesSearch(name, description, searchTerm) {
  if (!searchTerm) return true;
  const needle = searchTerm.toLowerCase();
  return (
    (name || '').toLowerCase().includes(needle) ||
    (description || '').toLowerCase().includes(needle)
  );
}
