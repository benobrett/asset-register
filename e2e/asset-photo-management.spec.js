import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

const PHOTO_FIXTURE = 'e2e/fixtures/test-photo.png';
const PHOTO_BUCKET = 'asset-photos';

// Each test gets its own asset with one synced photo, since they all
// mutate what they're given.
async function createAssetWithPhoto(page, supabase, label) {
  const assetName = `E2E ${label} ${Date.now()}`;
  await page.goto('/#/register');
  await page.getByRole('button', { name: 'Add New Asset' }).click();
  await page.getByLabel('Asset name').fill(assetName);
  await page.getByLabel('Description', { exact: true }).fill('Created for a photo-management e2e test.');
  await page.locator('#photo-input').setInputFiles(PHOTO_FIXTURE);
  await expect(page.locator('.photo-grid-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save asset' }).click();
  await expect(page).toHaveURL(/#\/register$/);

  const { data: asset } = await supabase
    .from('assets')
    .select('id')
    .eq('asset_name', assetName)
    .single();

  await expect
    .poll(
      async () => {
        const { data } = await supabase.from('asset_photos').select('id').eq('asset_id', asset.id);
        return data?.length ?? 0;
      },
      { timeout: 20_000, message: 'the seed photo never synced' }
    )
    .toBe(1);

  return { assetName, assetId: asset.id };
}

test('viewing is a safe mode: remove controls only appear behind Edit photos', async ({ page }) => {
  const supabase = await createTestSupabaseClient();
  const { assetId } = await createAssetWithPhoto(page, supabase, 'safe-mode');

  try {
    await page.goto(`/#/asset/${assetId}`);
    await expect(page.locator('.photo-thumb-button')).toHaveCount(1, { timeout: 15000 });

    // Nothing destructive on screen, and the thumbnail opens the viewer.
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await page.locator('.photo-thumb-button').first().click();
    await expect(page.getByRole('dialog', { name: 'Photo viewer' })).toBeVisible();
    await page.keyboard.press('Escape');

    // In edit mode the thumbnail stops competing for the same tap.
    await page.getByRole('button', { name: 'Edit photos' }).click();
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(1);
    await expect(page.locator('.photo-thumb-button').first()).toBeDisabled();

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  } finally {
    await supabase.from('assets').delete().eq('id', assetId);
  }
});

test('adds a photo to a saved asset and deletes a synced one, row and file', async ({ page }) => {
  const supabase = await createTestSupabaseClient();
  const { assetId } = await createAssetWithPhoto(page, supabase, 'manage');

  try {
    await page.goto(`/#/asset/${assetId}`);
    await expect(page.locator('.photo-thumb-button')).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('button', { name: 'Edit photos' }).click();

    await page.locator('#detail-photo-input').setInputFiles(PHOTO_FIXTURE);
    await expect(page.locator('.photo-thumb-button')).toHaveCount(2, { timeout: 20000 });

    const { data: added } = await supabase
      .from('asset_photos')
      .select('id, storage_path, position')
      .eq('asset_id', assetId)
      .order('position');
    expect(added.map((photo) => photo.position)).toEqual([1, 2]);

    const removed = added[0];
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.photo-thumb-button')).toHaveCount(1, { timeout: 20000 });

    // Positions are a sort key: removing the first leaves a gap rather
    // than renumbering the row that didn't change.
    const { data: remaining } = await supabase
      .from('asset_photos')
      .select('storage_path, position')
      .eq('asset_id', assetId);
    expect(remaining.map((photo) => photo.position)).toEqual([2]);

    // The file has to go too, not just the row - an orphaned object is
    // invisible until someone looks at the storage bill.
    const { error: downloadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .download(removed.storage_path);
    expect(downloadError).not.toBeNull();
  } finally {
    await supabase.from('assets').delete().eq('id', assetId);
  }
});

test('adding works offline; deleting a synced photo says it cannot', async ({ page, context }) => {
  const supabase = await createTestSupabaseClient();
  const { assetId } = await createAssetWithPhoto(page, supabase, 'offline');

  try {
    await page.goto(`/#/asset/${assetId}`);
    await expect(page.locator('.photo-thumb-button')).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('button', { name: 'Edit photos' }).click();

    await context.setOffline(true);

    // Deleting a synced photo needs a round trip for both the row and
    // the file, so it refuses plainly rather than appearing to work.
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('You need to be online to delete this photo.')).toBeVisible();
    await expect(page.locator('.photo-thumb-button')).toHaveCount(1);

    // Adding is the same act as capturing one - it has to work with no
    // signal, queued like any other create.
    await page.locator('#detail-photo-input').setInputFiles(PHOTO_FIXTURE);
    await expect(page.locator('.photo-thumb-button')).toHaveCount(2, { timeout: 20000 });

    // That second photo is local-only, so removing it needs no
    // connection either.
    await page.getByRole('button', { name: 'Remove' }).nth(1).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.photo-thumb-button')).toHaveCount(1, { timeout: 15000 });

    await context.setOffline(false);
  } finally {
    await context.setOffline(false);
    await supabase.from('assets').delete().eq('id', assetId);
  }
});

test('stops at four photos across saved and queued', async ({ page }) => {
  const supabase = await createTestSupabaseClient();
  const { assetId } = await createAssetWithPhoto(page, supabase, 'ceiling');

  try {
    await page.goto(`/#/asset/${assetId}`);
    await expect(page.locator('.photo-thumb-button')).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('button', { name: 'Edit photos' }).click();

    for (let count = 2; count <= 4; count += 1) {
      await page.locator('#detail-photo-input').setInputFiles(PHOTO_FIXTURE);
      await expect(page.locator('.photo-thumb-button')).toHaveCount(count, { timeout: 20000 });
    }

    // The ceiling counts everything attached to the asset, whichever
    // side of the sync it's on.
    await expect(page.getByRole('button', { name: 'Add photo' })).toBeDisabled();
    await expect(page.getByText(/Maximum of 4 photos/)).toBeVisible();
  } finally {
    await supabase.from('assets').delete().eq('id', assetId);
  }
});
