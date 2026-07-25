import { signOut } from '../auth.js';

export function renderHome(container, { navigate }) {
  container.innerHTML = `
    <section class="view view-home">
      <header class="view-header">
        <h1>Asset Register</h1>
        <button type="button" class="link-button" id="logout">Log out</button>
      </header>
      <div class="home-choices">
        <button type="button" class="choice-button" id="new-asset">
          New asset
        </button>
        <button type="button" class="choice-button" id="existing-asset">
          Existing asset
        </button>
      </div>
    </section>
  `;

  container.querySelector('#new-asset').addEventListener('click', () => navigate('#/capture'));
  container.querySelector('#existing-asset').addEventListener('click', () => navigate('#/register'));
  container.querySelector('#logout').addEventListener('click', async () => {
    await signOut();
    navigate('#/login');
  });
}
