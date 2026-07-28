import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

// 768px is the breakpoint in style.css - below it the card list shows and
// the table is display: none; at or above it, the reverse.
const PHONE_VIEWPORT = { width: 480, height: 800 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

test.describe('card list vs. table layout', () => {
  const assetName = `E2E responsive asset ${Date.now()}`;
  let supabase;
  let assetId;

  test.beforeAll(async () => {
    supabase = await createTestSupabaseClient();
    const { data, error } = await supabase
      .from('assets')
      .insert({ asset_name: assetName, description: 'Created for the responsive-layout e2e test.' })
      .select()
      .single();
    if (error) throw error;
    assetId = data.id;
  });

  test.afterAll(async () => {
    if (supabase && assetId) {
      await supabase.from('assets').delete().eq('id', assetId);
    }
  });

  test('a phone-width viewport shows the card list, not the table', async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto('/#/register');

    await expect(page.locator('#asset-list')).toBeVisible();
    await expect(page.locator('.asset-table-wrapper')).toBeHidden();
  });

  test('a desktop-width viewport shows the table, not the card list', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/#/register');

    await expect(page.locator('.asset-table-wrapper')).toBeVisible();
    await expect(page.locator('#asset-list')).toBeHidden();
  });

  test('navigating into an asset works in the card list', async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto('/#/register');
    await page.getByPlaceholder('Search assets…').fill(assetName);

    // Scoped and .first() - a plain name match would also catch the
    // row's "Delete <assetName>" button, since that aria-label contains
    // the asset name as a substring too. The main button renders first
    // in markup order.
    const row = page.locator('.asset-list-item').filter({ hasText: assetName });
    await row.getByRole('button').first().click();
    await expect(page).toHaveURL(/#\/asset\//);
    await expect(page.getByText(assetName)).toBeVisible();
  });

  test('navigating into an asset works in the table', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/#/register');
    await page.getByPlaceholder('Search assets…').fill(assetName);

    await page.getByRole('row', { name: assetName }).click();
    await expect(page).toHaveURL(/#\/asset\//);
    await expect(page.getByText(assetName)).toBeVisible();
  });
});

test('deletes an asset from the card list at phone width', async ({ page }) => {
  // The table layout has no delete button at all (only the card-list <li>
  // markup renders one) - see #67. Deletion is only reachable via the
  // card list today, so this is the one layout the interaction can
  // actually be tested in.
  await page.setViewportSize(PHONE_VIEWPORT);

  const deleteAssetName = `E2E responsive delete asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();
  const { data: asset, error } = await supabase
    .from('assets')
    .insert({
      asset_name: deleteAssetName,
      description: 'Created for the responsive-layout delete e2e test.',
    })
    .select()
    .single();
  if (error) throw error;

  let deleted = false;
  try {
    await page.goto('/#/register');
    await page.getByPlaceholder('Search assets…').fill(deleteAssetName);

    // The delete button only reveals on :hover/:focus-within and starts
    // pointer-events: none (see #67), so it can't be hovered as its own
    // target - hover the row (like a real mouse moving across it would)
    // instead.
    const row = page.locator('.asset-list-item').filter({ hasText: deleteAssetName });
    const deleteButton = page.getByRole('button', { name: `Delete ${deleteAssetName}` });

    // Same reason as register-view.spec.js's delete test: let the
    // debounced search render before acting, so its timer can't fire
    // mid-delete and blank the list out from under the assertions.
    await expect(row).toHaveCount(1);

    await row.hover();
    await deleteButton.click();

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
    deleted = true;
  } finally {
    if (!deleted) await supabase.from('assets').delete().eq('id', asset.id);
  }
});
