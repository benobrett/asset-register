import { test, expect } from '@playwright/test';

// Each describe block below needs its own logged-out or logged-in-as-a-
// specific-account starting state, which the project-level storageState
// (a signed-in, complete-profile session) doesn't provide - see each
// block's own test.use() override.

test.describe('no session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('redirects a protected route to login but leaves a public one alone', async ({ page }) => {
    await page.goto('/#/register');
    await expect(page).toHaveURL(/#\/login$/);

    await page.goto('/#/forgot-password');
    await expect(page).toHaveURL(/#\/forgot-password$/);
  });
});

test.describe('incomplete profile', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // A second, dedicated test account (see CLAUDE.md / migrations/e2e-seed-
  // test-user.sql) deliberately left with no name on file - the shared
  // E2E_TEST_EMAIL account always has one, and RLS forbids ever resetting
  // a name once it's set, so this scenario can't be produced from that
  // account. IMPORTANT: this test must never submit the complete-profile
  // form for this account - doing so would set its name permanently and
  // break this test for good.
  test('blocks entry to the rest of the app until a name is on file', async ({ page }) => {
    await page.goto('/#/login');
    await page.getByLabel('Email').fill(process.env.E2E_INCOMPLETE_PROFILE_EMAIL);
    await page.getByLabel('Password').fill(process.env.E2E_INCOMPLETE_PROFILE_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL(/#\/complete-profile$/);
    await expect(page.getByRole('heading', { name: 'One more thing' })).toBeVisible();

    // Blocks every other route, not just the one it happened to land on.
    await page.goto('/#/register');
    await expect(page).toHaveURL(/#\/complete-profile$/);
  });
});

test('a complete profile bounces #/complete-profile back to the register', async ({ page }) => {
  // Uses the project's default signed-in, complete-profile session (see
  // e2e/auth.setup.js) - covers a stale bookmark or the back button after
  // already completing the prompt.
  await page.goto('/#/complete-profile');
  await expect(page).toHaveURL(/#\/register$/);
});

test('a failed profile-completeness query fails open rather than blocking the app', async ({
  page,
}) => {
  // Simulates the query itself erroring (a network blip, not an offline
  // hang - that path is covered by offline-capture.spec.js) - isProfile
  // Complete() should catch this and let the user through rather than
  // stranding them.
  await page.route('**/rest/v1/profiles**', (route) => route.abort());

  await page.goto('/#/register');
  await expect(page).toHaveURL(/#\/register$/);
  // A longer timeout than usual - an aborted request doesn't make the
  // underlying fetch reject promptly either, so this genuinely exercises
  // auth.js's PROFILE_CHECK_TIMEOUT_MS bound rather than resolving
  // immediately on a clean rejection.
  await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible({ timeout: 10000 });
});
