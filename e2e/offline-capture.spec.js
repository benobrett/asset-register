import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

// Reads the IndexedDB offline queue directly (db.js's ASSET_STORE) rather
// than trusting the register view to show the record - it's the app's own
// real persistence, checked the same way whether the assertion is "queued
// offline" or "still queued because sync hasn't run yet".
async function findQueuedAsset(page, assetName) {
  return page.evaluate((name) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('asset-register');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('assets', 'readonly');
        const getAllRequest = tx.objectStore('assets').getAll();
        getAllRequest.onsuccess = () => {
          resolve(getAllRequest.result.some((asset) => asset.assetName === name));
        };
        getAllRequest.onerror = () => reject(getAllRequest.error);
      };
    });
  }, assetName);
}

test('captures a new asset offline and syncs it once back online', async ({ page, context }) => {
  const assetName = `E2E offline asset ${Date.now()}`;
  let supabase;

  await page.goto('/#/register');

  await context.setOffline(true);

  await page.getByRole('button', { name: 'Add New Asset' }).click();
  await expect(page).toHaveURL(/#\/capture$/);

  await page.getByLabel('Asset name').fill(assetName);
  // exact: true - "Description" would otherwise substring-match the New
  // repair form's "Repair description" field, which is also present (if
  // hidden) on this same page.
  await page.getByLabel('Description', { exact: true }).fill('Created by an offline e2e test.');
  await page.getByRole('button', { name: 'Save asset' }).click();

  // Saving queues to IndexedDB and navigates unconditionally - it doesn't
  // wait on a network round trip, so this should succeed with no error
  // shown even with no connection at all.
  await expect(page).toHaveURL(/#\/register$/);
  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(await findQueuedAsset(page, assetName)).toBe(true);

  try {
    await context.setOffline(false);

    supabase = await createTestSupabaseClient();
    await expect
      .poll(
        async () => {
          const { data } = await supabase
            .from('assets')
            .select('id')
            .eq('asset_name', assetName);
          return data?.length ?? 0;
        },
        { timeout: 15_000, message: 'asset never reached Supabase after reconnecting' }
      )
      .toBeGreaterThan(0);
  } finally {
    if (supabase) {
      await supabase.from('assets').delete().eq('asset_name', assetName);
    }
  }
});
