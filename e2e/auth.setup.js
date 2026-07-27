import { test as setup, expect } from '@playwright/test';

const authFile = 'e2e/.auth/user.json';

// Runs once, before the 'chromium' project, per playwright.config.js's
// project dependency - every other spec reuses this session via
// storageState instead of repeating the login flow itself. Specs that
// specifically need to exercise login (login.spec.js) override the
// project-level storageState back to logged-out.
setup('authenticate', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByLabel('Email').fill(process.env.E2E_TEST_EMAIL);
  await page.getByLabel('Password').fill(process.env.E2E_TEST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/#\/register$/);
  await page.context().storageState({ path: authFile });
});
