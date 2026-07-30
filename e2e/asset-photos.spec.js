import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

const PHOTO_FIXTURE = 'e2e/fixtures/test-photo.png';

// The native camera can't be automated, so setInputFiles supplies the
// file directly - see CLAUDE.md's testing limitations. What that does
// still cover is everything after the capture: accumulation, the limit,
// removal, and what actually reaches Supabase.
test('captures several photos and syncs them all', async ({ page }) => {
  const assetName = `E2E photos asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();

  await page.goto('/#/register');
  await page.getByRole('button', { name: 'Add New Asset' }).click();
  await page.getByLabel('Asset name').fill(assetName);
  await page.getByLabel('Description', { exact: true }).fill('Created by a photos e2e test.');

  const input = page.locator('#photo-input');
  for (let i = 0; i < 3; i += 1) {
    await input.setInputFiles(PHOTO_FIXTURE);
    await expect(page.locator('.photo-grid-item')).toHaveCount(i + 1);
  }

  await page.getByRole('button', { name: 'Save asset' }).click();
  await expect(page).toHaveURL(/#\/register$/);

  try {
    const { data: asset } = await supabase
      .from('assets')
      .select('id, photo_path')
      .eq('asset_name', assetName)
      .single();
    expect(asset).toBeTruthy();

    await expect
      .poll(
        async () => {
          const { data } = await supabase
            .from('asset_photos')
            .select('storage_path, position')
            .eq('asset_id', asset.id);
          return data?.length ?? 0;
        },
        { timeout: 20_000, message: 'photos never reached Supabase' }
      )
      .toBe(3);

    const { data: photos } = await supabase
      .from('asset_photos')
      .select('storage_path, position')
      .eq('asset_id', asset.id)
      .order('position');
    expect(photos.map((p) => p.position)).toEqual([1, 2, 3]);

    // Still written for clients running the pre-multi-photo version, and
    // pointing at the first photo rather than some other one.
    expect(asset.photo_path).toBe(photos[0].storage_path);

    // The rows are only half of it - the objects have to be in Storage
    // too, or the detail screen shows broken images.
    for (const photo of photos) {
      const { error } = await supabase.storage
        .from('asset-photos')
        .download(photo.storage_path);
      expect(error).toBeNull();
    }
  } finally {
    await supabase.from('assets').delete().eq('asset_name', assetName);
  }
});

test('stops at four photos and allows removing one', async ({ page }) => {
  await page.goto('/#/capture');

  const addButton = page.getByRole('button', { name: 'Add photo' });
  const input = page.locator('#photo-input');
  const thumbnails = page.locator('.photo-grid-item');

  for (let i = 0; i < 4; i += 1) {
    await input.setInputFiles(PHOTO_FIXTURE);
    await expect(thumbnails).toHaveCount(i + 1);
  }

  // Says why rather than going quiet - a control that silently does
  // nothing when tapped reads as broken.
  await expect(addButton).toBeDisabled();
  await expect(page.getByText(/Maximum of 4 photos/)).toBeVisible();

  // Removal is confirmed: a mis-tap here costs a walk back to the asset.
  await page.locator('.remove-photo-button').first().click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  // Scoped to the dialog - the thumbnails carry their own "Remove".
  await dialog.getByRole('button', { name: 'Remove' }).click();

  await expect(thumbnails).toHaveCount(3);
  await expect(addButton).toBeEnabled();
});

test('keeps a photo when the removal is cancelled', async ({ page }) => {
  await page.goto('/#/capture');

  const input = page.locator('#photo-input');
  await input.setInputFiles(PHOTO_FIXTURE);
  await expect(page.locator('.photo-grid-item')).toHaveCount(1);

  await page.locator('.remove-photo-button').first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();

  await expect(page.locator('.photo-grid-item')).toHaveCount(1);
});
