import { getSession, updatePassword } from '../auth.js';
import { validatePasswordResetForm } from '../validation.js';

// Clicking the emailed recovery link is what gets the user here - by the
// time this view renders, the Supabase client has already (via PKCE,
// automatically, on load) exchanged the link's code for a session. A
// missing session at this point means the link was expired or already
// used, not that the user is logged out in the usual sense - so this
// view has its own "no session" branch instead of getting redirected to
// #/login by main.js's usual gate (this route is exempt from that gate
// for exactly this reason).
export async function renderResetPassword(container, { navigate }) {
  const session = await getSession();

  if (!session) {
    container.innerHTML = `
      <section class="view view-login">
        <h1>Reset link expired</h1>
        <p class="login-welcome">
          This password reset link has expired or has already been used. Request a new one to
          keep going.
        </p>
        <div class="login-links">
          <button type="button" class="link-button" id="request-new-link">
            Request a new reset link
          </button>
        </div>
      </section>
    `;
    container
      .querySelector('#request-new-link')
      .addEventListener('click', () => navigate('#/forgot-password'));
    return;
  }

  container.innerHTML = `
    <section class="view view-login">
      <h1>Set a new password</h1>
      <form id="reset-password-form" novalidate>
        <label>
          New password
          <input type="password" name="password" autocomplete="new-password" minlength="6" required />
        </label>
        <p class="field-error" data-error-for="password" hidden></p>
        <label>
          Confirm password
          <input
            type="password"
            name="confirmPassword"
            autocomplete="new-password"
            minlength="6"
            required
          />
        </label>
        <p class="field-error" data-error-for="confirmPassword" hidden></p>
        <p class="form-error" id="submit-error" role="alert" hidden></p>
        <button type="submit">Set password</button>
      </form>
    </section>
  `;

  const form = container.querySelector('#reset-password-form');

  function showFieldErrors(errors) {
    for (const el of form.querySelectorAll('.field-error')) {
      el.hidden = true;
      el.textContent = '';
    }
    for (const [field, message] of Object.entries(errors)) {
      const el = form.querySelector(`[data-error-for="${field}"]`);
      if (el) {
        el.hidden = false;
        el.textContent = message;
      }
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;
    const submitError = form.querySelector('#submit-error');
    submitError.hidden = true;

    const { valid, errors } = validatePasswordResetForm({ password, confirmPassword });
    showFieldErrors(errors);
    if (!valid) return;

    // Same reasoning as the request step - setting a password needs a
    // live round trip, so this is never queued for later like the
    // offline-first asset/repair data is.
    if (!navigator.onLine) {
      submitError.hidden = false;
      submitError.textContent = 'You need to be online to reset your password.';
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await updatePassword(password);
      // Already has a valid session at this point - land wherever a
      // normal login would, not on a special "success" screen.
      navigate('#/register');
    } catch (err) {
      submitError.hidden = false;
      submitError.textContent = err.message || 'Something went wrong. Try again.';
      submitButton.disabled = false;
    }
  });
}
