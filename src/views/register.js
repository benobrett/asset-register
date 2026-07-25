import { supabase, getPhotoUrl } from '../supabase.js';

export function renderRegister(container, { navigate }) {
  container.innerHTML = `
    <section class="view view-register">
      <header class="view-header">
        <button type="button" class="link-button" id="back">&larr; Home</button>
        <h1>Assets</h1>
      </header>
      <input type="search" id="search" placeholder="Search assets…" />
      <p class="form-error" id="list-error" role="alert" hidden></p>
      <ul class="asset-list" id="asset-list"></ul>
    </section>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('#/home'));

  const listEl = container.querySelector('#asset-list');
  const errorEl = container.querySelector('#list-error');
  const searchInput = container.querySelector('#search');

  async function loadAssets(searchTerm) {
    listEl.innerHTML = '<li class="asset-list-status">Loading…</li>';
    errorEl.hidden = true;

    let query = supabase
      .from('assets')
      .select('id, asset_name, description, recorded_at, photo_path')
      .order('recorded_at', { ascending: false });

    if (searchTerm) {
      query = query.or(`asset_name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
    }

    const { data, error } = await query;

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

    listEl.innerHTML = '';
    for (const asset of data) {
      const item = document.createElement('li');
      item.className = 'asset-list-item';
      item.innerHTML = `
        <button type="button" class="asset-list-button" data-id="${asset.id}">
          <span class="asset-photo-thumb" data-thumb="${asset.id}"></span>
          <span class="asset-list-text">
            <span class="asset-name">${escapeHtml(asset.asset_name)}</span>
            <span class="asset-description">${escapeHtml(asset.description)}</span>
            <span class="asset-meta">${new Date(asset.recorded_at).toLocaleString()}</span>
          </span>
        </button>
      `;
      item.querySelector('.asset-list-button').addEventListener('click', () => {
        navigate(`#/asset/${asset.id}`);
      });
      listEl.appendChild(item);

      if (asset.photo_path) {
        getPhotoUrl(asset.photo_path)
          .then((url) => {
            const thumb = listEl.querySelector(`[data-thumb="${asset.id}"]`);
            if (url && thumb) {
              thumb.style.backgroundImage = `url(${url})`;
            }
          })
          .catch(() => {
            // Thumbnail is a nice-to-have; leave the placeholder if it fails.
          });
      }
    }
  }

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadAssets(searchInput.value.trim()), 250);
  });

  loadAssets('');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}
