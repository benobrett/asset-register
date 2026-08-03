import { test, expect } from '@playwright/test';

// Overrides the project-level (logged-in) storageState - this spec is
// specifically about the login form itself, so it needs to start each
// test logged out.
test.use({ storageState: { cookies: [], origins: [] } });

test('valid credentials reach the Assets screen', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByLabel('Email').fill(process.env.E2E_TEST_EMAIL);
  await page.getByLabel('Password').fill(process.env.E2E_TEST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL(/#\/register$/);
  await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible();
});

test('invalid credentials show an error and stay on the login screen', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByLabel('Email').fill(process.env.E2E_TEST_EMAIL);
  await page.getByLabel('Password').fill('definitely-the-wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();

  // Plain language, not Supabase's own "Invalid login credentials" - the
  // point of the mapping in login.js is that this string never reaches a
  // user, so assert on what replaced it rather than just "an alert".
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('don’t match an account');
  await expect(alert).not.toContainText(/invalid login credentials/i);
  await expect(page).toHaveURL(/#\/login$/);
});

test('switches to signup and back', async ({ page }) => {
  await page.goto('/#/login');
  await expect(page.getByLabel('First name')).toHaveCount(0);

  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByLabel('First name')).toBeVisible();
  await expect(page.getByLabel('Last name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
  // Forgot password belongs to the login form, not the signup one.
  await expect(page.getByRole('button', { name: 'Forgot password?' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Already have an account? Log in' }).click();
  await expect(page.getByLabel('First name')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});

// The layout traps called out in issue #94. Both are the kind of thing
// that looks fine on a desktop and makes the screen unusable on the
// tablet it's actually for.
test.describe('layout', () => {
  test('stays reachable when the viewport is short, as with the keyboard open', async ({
    page,
  }) => {
    // Roughly what's left of a tablet portrait viewport once the
    // on-screen keyboard is up.
    await page.setViewportSize({ width: 390, height: 360 });
    await page.goto('/#/login');

    const card = page.locator('.login-card');
    await expect(card).toBeVisible();

    // The failure this guards against is a locked height (or a centred
    // flex item overflowing both ways), where the page cannot scroll and
    // the fields below the fold simply cannot be reached.
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight
    );
    expect(scrollable).toBe(true);

    // Every control is genuinely reachable, not just present in the DOM.
    for (const name of ['Email', 'Password']) {
      await page.getByLabel(name).scrollIntoViewIfNeeded();
      await expect(page.getByLabel(name)).toBeInViewport();
    }
    await page.getByRole('button', { name: 'Log in' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeInViewport();

    // Scrolling back to the top has to work too - a centred flex item
    // that overflows upward leaves the logo permanently off-screen.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.login-logo')).toBeInViewport();
  });

  test('never scrolls horizontally, from phone width to tablet', async ({ page }) => {
    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/#/login');
      await expect(page.locator('.login-card')).toBeVisible();

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(overflows, `horizontal scrollbar at ${width}px`).toBe(false);
    }
  });
});
