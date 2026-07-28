import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

// The seeded name for the shared e2e account - see
// migrations/e2e-seed-test-user.sql.
const PROFILE_BUTTON = /Your profile/;

test('opens and closes on click, outside click, Escape, and route change', async ({ page }) => {
  await page.goto('/#/register');

  const button = page.getByRole('button', { name: PROFILE_BUTTON });
  const popover = page.getByRole('dialog', { name: 'Your profile' });

  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(popover).toBeHidden();

  await button.click();
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('Test User');
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  // The profile data itself stays read-only - Log out is an action, not
  // a way to edit a name. No form field, no link to the edit gate.
  await expect(popover.getByRole('textbox')).toHaveCount(0);
  await expect(popover.getByRole('link')).toHaveCount(0);
  await expect(popover.getByRole('button')).toHaveCount(1);
  await expect(popover.getByRole('button', { name: 'Log out' })).toBeVisible();

  // A second click on the icon closes it again.
  await button.click();
  await expect(popover).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  // Outside click.
  await button.click();
  await expect(popover).toBeVisible();
  await page.getByRole('heading', { name: 'Assets' }).click();
  await expect(popover).toBeHidden();

  // Escape, which also returns focus to the icon.
  await button.click();
  await expect(popover).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(button).toBeFocused();

  // Route change. Triggered from the capture screen's top-left back
  // button: an open popover legitimately covers the content beneath it
  // (including the register's "Add New Asset"), and a click there
  // dismisses the popover rather than passing through to what's under
  // it - normal popover behaviour, but it would conflate dismissal with
  // the navigation this step is actually about.
  await page.getByRole('button', { name: 'Add New Asset' }).click();
  await expect(page).toHaveURL(/#\/capture$/);
  await button.click();
  await expect(popover).toBeVisible();
  await page.getByRole('button', { name: '← Assets' }).click();
  await expect(page).toHaveURL(/#\/register$/);
  await expect(popover).toBeHidden();
});

test('is keyboard operable', async ({ page }) => {
  await page.goto('/#/register');

  const button = page.getByRole('button', { name: PROFILE_BUTTON });
  const popover = page.getByRole('dialog', { name: 'Your profile' });

  await button.focus();
  await page.keyboard.press('Enter');
  await expect(popover).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();

  await page.keyboard.press('Space');
  await expect(popover).toBeVisible();
});

test('leaves the underlying view and scroll position untouched', async ({ page }) => {
  // Deliberately short, so the page genuinely scrolls. Measuring at the
  // top of an unscrolled page proves nothing: the bug this guards against
  // (chrome that scrolls away with the content, so reaching the icon
  // drags the user back to the top) only appears once scrolled.
  await page.setViewportSize({ width: 480, height: 400 });
  await page.goto('/#/register');

  const button = page.getByRole('button', { name: PROFILE_BUTTON });
  const popover = page.getByRole('dialog', { name: 'Your profile' });

  // Baseline is taken only once the page has settled - the chrome is
  // revealed after route()'s async session check, and the register's rows
  // arrive after their query, both of which change the page height on
  // their own.
  await expect(button).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 120));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);

  // Stamped straight onto the live DOM node, not an attribute - a
  // re-render replaces the node itself, taking the property with it, so
  // this survives only if the view was genuinely left alone.
  await page.evaluate(() => {
    document.querySelector('#app').dataset.untouchedMarker = 'original';
  });

  await button.click();
  await expect(popover).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  await button.click();
  await expect(popover).toBeHidden();

  await expect(page.locator('#app')).toHaveAttribute('data-untouched-marker', 'original');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
});

// detail.js's repair Information/Comment handlers call stopPropagation(),
// so a bubble-phase outside-click listener never sees these clicks and the
// popover would sit open on top of the panel they just opened.
test('closes on an outside click that stops propagation', async ({ page }) => {
  const assetName = `E2E profile stopprop asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();
  const { data: asset, error } = await supabase
    .from('assets')
    .insert({ asset_name: assetName, description: 'Seeded for the profile-menu stopPropagation e2e test.' })
    .select()
    .single();
  if (error) throw error;

  const { error: repairError } = await supabase.from('asset_repairs').insert({
    asset_id: asset.id,
    description: 'Seeded repair.',
    created_by_email: 'seed@example.com',
  });
  if (repairError) throw repairError;

  try {
    await page.goto(`/#/asset/${asset.id}`);

    const button = page.getByRole('button', { name: PROFILE_BUTTON });
    const popover = page.getByRole('dialog', { name: 'Your profile' });
    const repairItem = page.getByRole('listitem').filter({ hasText: 'Seeded repair.' });

    await expect(repairItem.getByRole('button', { name: 'Information' })).toBeVisible();
    await button.click();
    await expect(popover).toBeVisible();

    await repairItem.getByRole('button', { name: 'Information' }).click();
    await expect(popover).toBeHidden();
  } finally {
    await supabase.from('assets').delete().eq('id', asset.id);
  }
});

test('a confirm dialog closes the popover rather than opening behind it', async ({ page }) => {
  // The register's quick-delete button only renders in the card list (see
  // #67), which needs a phone-width viewport.
  await page.setViewportSize({ width: 480, height: 800 });

  const assetName = `E2E profile modal asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();
  const { data: asset, error } = await supabase
    .from('assets')
    .insert({ asset_name: assetName, description: 'Seeded for the profile-menu modal e2e test.' })
    .select()
    .single();
  if (error) throw error;

  try {
    await page.goto('/#/register');
    await page.getByPlaceholder('Search assets…').fill(assetName);

    const button = page.getByRole('button', { name: PROFILE_BUTTON });
    const popover = page.getByRole('dialog', { name: 'Your profile' });

    await button.click();
    await expect(popover).toBeVisible();

    // See #67 for why the row, not the button, is hovered.
    const row = page.locator('.asset-list-item').filter({ hasText: assetName });
    await row.hover();
    await page.getByRole('button', { name: `Delete ${assetName}` }).click();

    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(popover).toBeHidden();

    await page.getByRole('button', { name: 'Cancel' }).click();
  } finally {
    await supabase.from('assets').delete().eq('id', asset.id);
  }
});

test.describe('visibility', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Logging out mutates the shared storage state, so it belongs in this
  // signed-out block with its own session rather than leaking a logged-out
  // state into the tests above.
  test('logs out from the popover, from any screen', async ({ page }) => {
    await page.goto('/#/login');
    await page.getByLabel('Email').fill(process.env.E2E_TEST_EMAIL);
    await page.getByLabel('Password').fill(process.env.E2E_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/#\/register$/);

    // Deliberately not the register: logout used to live in that view's
    // own header and was unreachable from anywhere else. As chrome it
    // has to work here too.
    await page.getByRole('button', { name: 'Add New Asset' }).click();
    await expect(page).toHaveURL(/#\/capture$/);

    await page.getByRole('button', { name: PROFILE_BUTTON }).click();
    await page.getByRole('button', { name: 'Log out' }).click();

    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByRole('button', { name: PROFILE_BUTTON })).toHaveCount(0);

    // Genuinely signed out, not just navigated away - a protected route
    // bounces straight back to the login screen.
    await page.goto('/#/register');
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('is hidden on the login screen and shown once signed in', async ({ page }) => {
    await page.goto('/#/login');
    await expect(page.getByRole('button', { name: PROFILE_BUTTON })).toHaveCount(0);

    await page.getByLabel('Email').fill(process.env.E2E_TEST_EMAIL);
    await page.getByLabel('Password').fill(process.env.E2E_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL(/#\/register$/);
    await expect(page.getByRole('button', { name: PROFILE_BUTTON })).toBeVisible();
  });

  // That route is a blocking gate for accounts with no name on file -
  // an icon there would be both empty and misleading, suggesting a way
  // out of a screen deliberately not offering one.
  test('is hidden on the blocking complete-profile gate', async ({ page }) => {
    await page.goto('/#/login');
    await page.getByLabel('Email').fill(process.env.E2E_INCOMPLETE_PROFILE_EMAIL);
    await page.getByLabel('Password').fill(process.env.E2E_INCOMPLETE_PROFILE_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL(/#\/complete-profile$/);
    await expect(page.getByRole('button', { name: PROFILE_BUTTON })).toHaveCount(0);
  });
});
