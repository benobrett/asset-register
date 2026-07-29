import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

test('cancelling a new asset returns to the register without saving it', async ({ page }) => {
  const assetName = `E2E cancelled asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();

  await page.goto('/#/register');
  await page.getByRole('button', { name: 'Add New Asset' }).click();
  await expect(page).toHaveURL(/#\/capture$/);

  // Filled in first: the point of the test is that this is discarded, and
  // that Cancel doesn't submit the form it sits inside - a <button> with
  // no explicit type="button" would.
  await page.getByLabel('Asset name').fill(assetName);
  await page.getByLabel('Description', { exact: true }).fill('Should never be saved.');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/#\/register$/);

  // Nothing reached the server...
  const { data: rows } = await supabase.from('assets').select('id').eq('asset_name', assetName);
  expect(rows).toHaveLength(0);

  // ...and nothing was left sitting in the offline queue either, which a
  // submitted form would have written before it ever tried the network.
  const queued = await page.evaluate((name) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('asset-register');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction('assets', 'readonly');
        const all = tx.objectStore('assets').getAll();
        all.onsuccess = () => resolve(all.result.some((asset) => asset.assetName === name));
        all.onerror = () => reject(all.error);
      };
    });
  }, assetName);
  expect(queued).toBe(false);
});
