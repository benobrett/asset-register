import { signIn, signUp } from '../auth.js';
import { validateNameForm, validatePassword } from '../validation.js';
// Imported (not a public/ absolute path) so Vite resolves and base-prefixes
// it correctly when the app is deployed under a subpath, e.g. GitHub Pages'
// /asset-register/ — a plain "/logo.png" string is left untouched by Vite
// and would 404 there.
import logoUrl from '../assets/brook-waimarama-sanctuary-logo.png';

export function renderLogin(container, { navigate }) {
  let mode = 'login'; // or 'signup'

  function draw() {
    container.innerHTML = `
      <section class="view view-login">
        <img
          src="${logoUrl}"
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
          ${
            mode === 'signup'
              ? `
          <label>
            First name
            <input type="text" name="firstName" autocomplete="given-name" required />
          </label>
          <p class="field-error" data-error-for="firstName" hidden></p>
          <label>
            Last name
            <input type="text" name="lastName" autocomplete="family-name" required />
          </label>
          <p class="field-error" data-error-for="lastName" hidden></p>
          `
              : ''
          }
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
          <p class="field-error" data-error-for="password" hidden></p>
          <p class="form-error" id="auth-error" role="alert" hidden></p>
          <button type="submit">${mode === 'login' ? 'Log in' : 'Sign up'}</button>
        </form>
        <div class="login-links">
          <button type="button" class="link-button" id="mode-toggle">
            ${mode === 'login' ? 'Sign up' : 'Already have an account? Log in'}
          </button>
          ${
            mode === 'login'
              ? '<button type="button" class="link-button" id="forgot-password-link">Forgot password?</button>'
              : ''
          }
        </div>
      </section>
    `;

    container.querySelector('#mode-toggle').addEventListener('click', () => {
      mode = mode === 'login' ? 'signup' : 'login';
      draw();
    });

    const forgotPasswordLink = container.querySelector('#forgot-password-link');
    if (forgotPasswordLink) {
      forgotPasswordLink.addEventListener('click', () => navigate('#/forgot-password'));
    }

    function showFieldErrors(errors) {
      for (const el of container.querySelectorAll('.field-error')) {
        el.hidden = true;
        el.textContent = '';
      }
      for (const [field, message] of Object.entries(errors)) {
        const el = container.querySelector(`[data-error-for="${field}"]`);
        if (el) {
          el.hidden = false;
          el.textContent = message;
        }
      }
    }

    container.querySelector('#auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const email = form.email.value.trim();
      const password = form.password.value;
      const errorEl = container.querySelector('#auth-error');
      errorEl.hidden = true;

      if (mode === 'signup') {
        const firstName = form.firstName.value;
        const lastName = form.lastName.value;
        const { valid, errors } = validateNameForm({ firstName, lastName });
        const passwordError = validatePassword(password);
        if (passwordError) errors.password = passwordError;
        showFieldErrors(errors);
        if (!valid || passwordError) return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        if (mode === 'login') {
          await signIn(email, password);
          navigate('#/register');
        } else {
          await signUp(email, password, form.firstName.value.trim(), form.lastName.value.trim());
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
