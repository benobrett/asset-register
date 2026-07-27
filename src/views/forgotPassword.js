import { requestPasswordReset } from '../auth.js';

export function renderForgotPassword(container, { navigate }) {
  container.innerHTML = `
    <section class="view view-login">
      <h1>Reset password</h1>
      <p class="login-welcome">
        Enter the email address on your account and we'll send you a link to reset your
        password.
      </p>
      <form id="forgot-password-form" novalidate>
        <label>
          Email
          <input type="email" name="email" autocomplete="email" required />
        </label>
        <p class="field-error" data-error-for="email" hidden></p>
        <p class="form-error" id="submit-error" role="alert" hidden></p>
        <button type="submit">Send reset link</button>
      </form>
      <div class="login-links">
        <button type="button" class="link-button" id="back-to-login">Back to login</button>
      </div>
    </section>
  `;

  container.querySelector('#back-to-login').addEventListener('click', () => navigate('#/login'));

  const form = container.querySelector('#forgot-password-form');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = form.email.value.trim();
    const fieldError = form.querySelector('[data-error-for="email"]');
    const submitError = form.querySelector('#submit-error');
    fieldError.hidden = true;
    submitError.hidden = true;

    if (!email) {
      fieldError.hidden = false;
      fieldError.textContent = 'Email is required.';
      return;
    }

    // A password reset needs a live round trip - there's no meaningful
    // "sync later" for it, so this is never queued like the offline-first
    // asset/repair data is.
    if (!navigator.onLine) {
      submitError.hidden = false;
      submitError.textContent = 'You need to be online to reset your password.';
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await requestPasswordReset(email);
    } catch (err) {
      submitError.hidden = false;
      submitError.textContent = err.message || 'Something went wrong. Try again.';
      submitButton.disabled = false;
      return;
    }

    // Same message regardless of whether the address actually has an
    // account - Supabase itself doesn't reveal that, and showing a
    // different result for an unknown address would undo that on our end.
    form.hidden = true;
    submitError.hidden = true;
    const confirmation = document.createElement('p');
    confirmation.className = 'form-error form-notice';
    confirmation.setAttribute('role', 'status');
    confirmation.textContent = 'If that email has an account, a reset link is on its way.';
    form.insertAdjacentElement('afterend', confirmation);
  });
}
