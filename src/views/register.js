import { supabase } from '../supabase.js';
import { formatAssetId } from '../format.js';
import { confirmDialog } from '../confirmDialog.js';

const SORT_OPTIONS = {
  newest: { column: 'recorded_at', ascending: false },
  oldest: { column: 'recorded_at', ascending: true },
  'name-asc': { column: 'asset_name', ascending: true },
  'name-desc': { column: 'asset_name', ascending: false },
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
        <button type="button" class="link-button" id="back">&larr; Home</button>
        <h1>Assets</h1>
      </header>
      <p class="register-intro">Below is a list of all the assets for the Brook Waimārama Sanctuary.</p>
      <input type="search" id="search" placeholder="Search assets…" />
      <label class="sort-label">
        Sort by
        <select id="sort-select">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name-asc">Name (A–Z)</option>
          <option value="name-desc">Name (Z–A)</option>
        </select>
      </label>
      <p class="form-error" id="list-error" role="alert" hidden></p>
      <ul class="asset-list" id="asset-list"></ul>
    </section>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('#/home'));

  const listEl = container.querySelector('#asset-list');
  const errorEl = container.querySelector('#list-error');
  const searchInput = container.querySelector('#search');
  const sortSelect = container.querySelector('#sort-select');

  async function loadAssets(searchTerm, sortKey) {
    listEl.innerHTML = '<li class="asset-list-status">Loading…</li>';
    errorEl.hidden = true;

    const sort = SORT_OPTIONS[sortKey];
    let query = supabase
      .from('assets')
      .select('id, asset_number, asset_name, recorded_at')
      .order(sort.column, { ascending: sort.ascending });

    if (searchTerm) {
      // Description is no longer shown in the list, but it's still worth
      // matching on — the issue only asked to change what's displayed,
      // not what's searchable.
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
      errorEl.hidden = false;
      errorEl.textContent = error.message || 'Could not load assets.';
      return;
    }

    if (!data.length) {
      listEl.innerHTML = '<li class="asset-list-status">No assets found.</li>';
      return;
    }

    const outstandingAssetIds = new Set();
    const repairCounts = new Map();
    for (const repair of repairsResult.data || []) {
      repairCounts.set(repair.asset_id, (repairCounts.get(repair.asset_id) ?? 0) + 1);
      if (!repair.completed_at) {
        outstandingAssetIds.add(repair.asset_id);
      }
    }

    listEl.innerHTML = '';
    for (const asset of data) {
      const hasOutstandingRepair = outstandingAssetIds.has(asset.id);
      const repairCount = repairCounts.get(asset.id) ?? 0;

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
      item.querySelector('.delete-asset-button').addEventListener('click', async (event) => {
        event.stopPropagation();

        const confirmed = await confirmDialog({
          message: `Delete "${asset.asset_name}"? This will also delete its ${repairCount} repair record${repairCount === 1 ? '' : 's'}. This can't be undone.`,
        });
        if (!confirmed) return;

        errorEl.hidden = true;
        const { error: deleteError } = await supabase.from('assets').delete().eq('id', asset.id);
        if (deleteError) {
          errorEl.hidden = false;
          errorEl.textContent = deleteError.message || 'Could not delete this asset.';
          return;
        }

        item.remove();
        if (!listEl.children.length) {
          listEl.innerHTML = '<li class="asset-list-status">No assets found.</li>';
        }
      });
      listEl.appendChild(item);
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
