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

// Issue #105: on Android, returning from the device camera destroyed the
// capture form - the photo wasn't attached and the title already typed
// was gone. A reload is the closest this suite can get to that: it
// reproduces the cause-A shape (the page being discarded and rebuilt),
// which is what the draft has to survive. It does not reproduce cause B
// (the app re-rendering itself on resume), and neither can Playwright
// drive a real camera hand-off - see the issue's manual test plan.
test.describe('the capture form survives being destroyed', () => {
  test('restores what was typed, and the photo, after a reload', async ({ page }) => {
    const assetName = `E2E draft ${Date.now()}`;

    await page.goto('/#/register');
    await page.getByRole('button', { name: 'Add New Asset' }).click();
    await page.getByLabel('Asset name').fill(assetName);
    await page.getByLabel('Description', { exact: true }).fill('Typed before the camera opened.');
    await page.locator('#photo-input').setInputFiles('e2e/fixtures/test-photo.png');
    await expect(page.locator('.photo-grid-item')).toHaveCount(1);

    // The draft is written on input and on capture, both of which have
    // happened; nothing here waits on a timer, so there's no sleep.
    await page.reload();
    await expect(page).toHaveURL(/#\/capture$/);

    // The whole bug in one assertion: the title is what proved the form
    // had been destroyed rather than the photo merely failing to attach.
    await expect(page.getByLabel('Asset name')).toHaveValue(assetName);
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
      'Typed before the camera opened.'
    );
    await expect(page.locator('.photo-grid-item')).toHaveCount(1);

    // And the restored photo is a real image, not a dead object URL from
    // the document that no longer exists.
    const usable = await page.evaluate(() => {
      const img = document.querySelector('.photo-grid-item img');
      return img.complete && img.naturalWidth > 0;
    });
    expect(usable).toBe(true);
  });

  test('leaving discards the draft, so the next asset starts empty', async ({ page }) => {
    const assetName = `E2E abandoned ${Date.now()}`;

    await page.goto('/#/capture');
    await page.getByLabel('Asset name').fill(assetName);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/#\/register$/);

    // Restoring here would silently pre-fill someone else's details onto
    // the next asset - worse than losing them.
    await page.getByRole('button', { name: 'Add New Asset' }).click();
    await expect(page.getByLabel('Asset name')).toHaveValue('');
    await expect(page.locator('.photo-grid-item')).toHaveCount(0);
  });

  test('saving clears the draft', async ({ page }) => {
    const assetName = `E2E saved draft ${Date.now()}`;
    const supabase = await createTestSupabaseClient();

    try {
      await page.goto('/#/capture');
      await page.getByLabel('Asset name').fill(assetName);
      await page.getByLabel('Description', { exact: true }).fill('Saved, so no draft remains.');
      await page.getByRole('button', { name: 'Save asset' }).click();
      await expect(page).toHaveURL(/#\/register$/);

      await page.getByRole('button', { name: 'Add New Asset' }).click();
      await expect(page.getByLabel('Asset name')).toHaveValue('');
    } finally {
      await supabase.from('assets').delete().eq('asset_name', assetName);
    }
  });
});
