import { supabase } from '../supabase.js';
import { signOut } from '../auth.js';
import { formatAssetId } from '../format.js';
import { confirmDialog } from '../confirmDialog.js';

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
        <button type="button" class="link-button" id="logout">Log out</button>
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
  container.querySelector('#logout').addEventListener('click', async () => {
    await signOut();
    navigate('#/login');
  });

  const listEl = container.querySelector('#asset-list');
  const tableBodyEl = container.querySelector('#asset-table-body');
  const errorEl = container.querySelector('#list-error');
  const searchInput = container.querySelector('#search');
  const sortSelect = container.querySelector('#sort-select');

  async function loadAssets(searchTerm, sortKey) {
    listEl.innerHTML = '<li class="asset-list-status">Loading…</li>';
    tableBodyEl.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    errorEl.hidden = true;

    const sort = SORT_OPTIONS[sortKey];
    let query = supabase
      .from('assets')
      .select('id, asset_number, asset_name, description, recorded_at')
      .order(sort.column, { ascending: sort.ascending });

    if (searchTerm) {
      query = query.or(`asset_name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
    }

    const [{ data, error }, repairsResult] = await Promise.all([
      query,
      // A plain query rather than embedding assets->asset_repairs via
      // PostgREST's relationship syntax — that relies on its schema
      // cache recognizing the foreign key, which proved unreliable.
      // Fetches every repair (not just outstanding ones) since the
      // delete-confirmation message needs a total count per asset too.
      supabase.from('asset_repairs').select('asset_id, completed_at'),
    ]);

    if (error) {
      listEl.innerHTML = '';
      tableBodyEl.innerHTML = '';
      errorEl.hidden = false;
      errorEl.textContent = error.message || 'Could not load assets.';
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

    if (!displayData.length) {
      const emptyMessage = sort.repairsOnly ? 'No assets with repairs found.' : 'No assets found.';
      listEl.innerHTML = `<li class="asset-list-status">${emptyMessage}</li>`;
      tableBodyEl.innerHTML = `<tr><td colspan="5">${emptyMessage}</td></tr>`;
      return;
    }

    listEl.innerHTML = '';
    tableBodyEl.innerHTML = '';
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
        <td>${hasOutstandingRepair ? '<span class="repair-tag">🔧 Outstanding</span>' : 'OK'}</td>
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
    loadAssets(searchInput.value.trim(), sortSelect.value);
  });

  loadAssets('', sortSelect.value);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}
