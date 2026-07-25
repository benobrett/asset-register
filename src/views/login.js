import { signIn, signUp } from '../auth.js';

export function renderLogin(container, { navigate }) {
  let mode = 'login'; // or 'signup'

  function draw() {
    container.innerHTML = `
      <section class="view view-login">
        <img
          src="/brook-waimarama-sanctuary-logo.png"
          alt="The Brook Waimārama Sanctuary, Nelson New Zealand"
          class="login-logo"
        />
        <h1>Asset Register</h1>
        <p class="login-welcome">
          Welcome to the Brook Waimārama Sanctuary Asset Register. Use this app to log new
          assets with a photo and details, track repairs, and keep the sanctuary's equipment
          register up to date in the field — even without a signal.
        </p>
        <form id="auth-form" novalidate>
          <label>
            Email
            <input type="email" name="email" autocomplete="email" required />
          </label>
          <label>
            Password
            <input type="password" name="password" autocomplete="${
              mode === 'login' ? 'current-password' : 'new-password'
            }" minlength="6" required />
          </label>
          <p class="form-error" id="auth-error" role="alert" hidden></p>
          <button type="submit">${mode === 'login' ? 'Log in' : 'Sign up'}</button>
        </form>
        <button type="button" class="link-button" id="mode-toggle">
          ${
            mode === 'login'
              ? "Need an account? Sign up"
              : 'Already have an account? Log in'
          }
        </button>
      </section>
    `;

    container.querySelector('#mode-toggle').addEventListener('click', () => {
      mode = mode === 'login' ? 'signup' : 'login';
      draw();
    });

    container.querySelector('#auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const email = form.email.value.trim();
      const password = form.password.value;
      const errorEl = container.querySelector('#auth-error');
      errorEl.hidden = true;

      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        if (mode === 'login') {
          await signIn(email, password);
          navigate('#/register');
        } else {
          await signUp(email, password);
          errorEl.hidden = false;
          errorEl.textContent = 'Account created — check your email to confirm, then log in.';
          errorEl.classList.add('form-notice');
        }
      } catch (err) {
        errorEl.hidden = false;
        errorEl.classList.remove('form-notice');
        errorEl.textContent = err.message || 'Something went wrong. Try again.';
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  draw();
}
