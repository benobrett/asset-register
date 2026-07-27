import { submitProfileName, markProfileComplete } from '../auth.js';
import { validateNameForm } from '../validation.js';

// Blocking post-login prompt for accounts with no name on file yet -
// pre-existing accounts from before this feature, and Google sign-ins,
// which never go through the signup form's name fields. The session is
// already valid throughout (the user is logged in, just not into the app
// yet), so this is purely a client-side gate in main.js's routing, not a
// separate auth step.
export function renderCompleteProfile(container, { navigate }) {
  function draw() {
    container.innerHTML = `
      <section class="view view-login">
        <h1>One more thing</h1>
        <p class="login-welcome">
          We've added names to accounts — please tell us yours before continuing.
        </p>
        <form id="complete-profile-form" novalidate>
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
          <p class="form-error" id="submit-error" role="alert" hidden></p>
          <button type="submit">Continue</button>
        </form>
      </section>
    `;

    const form = container.querySelector('#complete-profile-form');

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
      const submitError = form.querySelector('#submit-error');
      submitError.hidden = true;

      const firstName = form.firstName.value;
      const lastName = form.lastName.value;
      const { valid, errors } = validateNameForm({ firstName, lastName });
      showFieldErrors(errors);
      if (!valid) return;

      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        await submitProfileName(firstName.trim(), lastName.trim());
        markProfileComplete();
        navigate('#/register');
      } catch (err) {
        // Stays on the prompt with a retryable error rather than being
        // kicked back to login - the session is still valid, this was
        // just a save failure.
        submitError.hidden = false;
        submitError.textContent = err.message || 'Could not save your name. Try again.';
        submitButton.disabled = false;
      }
    });
  }

  draw();
}
