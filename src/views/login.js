import { signIn, signUp } from '../auth.js';
import { validateNameForm, validatePassword } from '../validation.js';
// Imported (not a public/ absolute path) so Vite resolves and base-prefixes
// it correctly when the app is deployed under a subpath, e.g. GitHub Pages'
// /asset-register/ — a plain "/logo.png" string is left untouched by Vite
// and would 404 there.
import logoUrl from '../assets/brook-waimarama-sanctuary-logo.png';

// Supabase's own error strings are written for a developer reading a log,
// not for someone standing at a gate in the rain wondering why they can't
// get in. Each of these says what went wrong *and* what to do about it;
// anything unrecognised falls through to a plain generic rather than being
// shown raw.
function friendlyAuthError(err, mode) {
  const raw = (err?.message || '').toLowerCase();

  // A fetch that never reached Supabase. Logging in is the one thing in
  // this app that genuinely can't be queued for later, so say so plainly -
  // the same way the password-reset screens do.
  if (raw.includes('fetch') || raw.includes('network') || !navigator.onLine) {
    return 'No connection. You need to be online to ' + (mode === 'login' ? 'log in' : 'sign up') + '.';
  }
  if (raw.includes('invalid login credentials')) {
    return 'That email and password don’t match an account. Check both and try again.';
  }
  if (raw.includes('email not confirmed')) {
    return 'This account hasn’t been confirmed yet. Check your email for the confirmation link.';
  }
  if (raw.includes('already registered') || raw.includes('already been registered')) {
    return 'There’s already an account with that email. Log in instead, or reset the password.';
  }
  if (raw.includes('rate limit') || raw.includes('after')) {
    return 'Too many attempts just now. Wait a minute and try again.';
  }
  return 'Something went wrong. Try again.';
}

export function renderLogin(container, { navigate }) {
  let mode = 'login'; // or 'signup'

  function draw() {
    container.innerHTML = `
      <section class="view view-login">
        <div class="login-card">
          <header class="login-lockup">
            <img
              src="${logoUrl}"
              alt="The Brook Waimārama Sanctuary, Nelson New Zealand"
              class="login-logo"
            />
            <h1>Asset Register</h1>
          </header>
          <p class="login-welcome">
            ${
              mode === 'login'
                ? 'Log assets, track repairs, and keep the sanctuary’s equipment register up to date in the field — even without a signal.'
                : 'Create an account to start logging assets and repairs.'
            }
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
              ${mode === 'login' ? 'Create an account' : 'Already have an account? Log in'}
            </button>
            ${
              mode === 'login'
                ? '<button type="button" class="link-button" id="forgot-password-link">Forgot password?</button>'
                : ''
            }
          </div>
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
          errorEl.textContent = 'Account created. Check your email to confirm, then log in.';
          errorEl.classList.add('form-notice');
        }
      } catch (err) {
        errorEl.hidden = false;
        errorEl.classList.remove('form-notice');
        errorEl.textContent = friendlyAuthError(err, mode);
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  draw();
}
