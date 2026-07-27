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

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/#\/login$/);
});
