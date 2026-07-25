import { supabase } from '../supabase.js';
import { formatAssetId } from '../format.js';

const SORT_OPTIONS = {
  newest: { column: 'recorded_at', ascending: false },
  oldest: { column: 'recorded_at', ascending: true },
  'name-asc': { column: 'asset_name', ascending: true },
  'name-desc': { column: 'asset_name', ascending: false },
};

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
      // Only outstanding repairs count towards the highlight — once
      // every repair on an asset is marked completed, it should clear.
      supabase.from('asset_repairs').select('asset_id').is('completed_at', null),
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

    const assetIdsWithOutstandingRepairs = new Set(
      (repairsResult.data || []).map((r) => r.asset_id)
    );

    listEl.innerHTML = '';
    for (const asset of data) {
      const hasOutstandingRepair = assetIdsWithOutstandingRepairs.has(asset.id);

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
      `;
      item.querySelector('.asset-list-button').addEventListener('click', () => {
        navigate(`#/asset/${asset.id}`);
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
