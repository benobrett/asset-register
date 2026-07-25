import { supabase, getPhotoUrl } from '../supabase.js';

export async function renderDetail(container, { navigate, params }) {
  container.innerHTML = `
    <section class="view view-detail">
      <header class="view-header">
        <button type="button" class="link-button" id="back">&larr; Assets</button>
        <h1>Asset</h1>
      </header>
      <p id="detail-status">Loading…</p>
    </section>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('#/register'));

  const { data: asset, error } = await supabase
    .from('assets')
    .select('id, description, recorded_at, photo_path, repair_needed, repair_description, repair_completed_at')
    .eq('id', params.id)
    .single();

  const statusEl = container.querySelector('#detail-status');

  if (error || !asset) {
    statusEl.textContent = error?.message || 'Asset not found.';
    return;
  }

  let photoUrl = null;
  if (asset.photo_path) {
    try {
      photoUrl = await getPhotoUrl(asset.photo_path);
    } catch {
      // Photo failed to load a signed URL; render without it.
    }
  }

  statusEl.remove();

  const section = container.querySelector('.view-detail');
  const article = document.createElement('article');
  article.className = 'asset-detail';
  article.innerHTML = `
    ${photoUrl ? `<img src="${photoUrl}" alt="Asset photo" class="asset-detail-photo" />` : ''}
    <dl>
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
  `;
  section.appendChild(article);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}
