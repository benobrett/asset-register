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

// Deleting used to be card-list-only, which is what this file had a
// delete test for. Since #67 it lives on the asset's own page, identical
// at both widths, and is covered by register-view.spec.js - there's no
// longer anything layout-specific about it to test here.
