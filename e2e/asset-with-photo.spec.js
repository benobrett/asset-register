import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png');
// Matches PHOTO_BUCKET in src/supabase.js - can't import that file directly
// here, since it reads import.meta.env, which only exists inside Vite's
// bundling context, not a plain Node/Playwright process.
const PHOTO_BUCKET = 'asset-photos';

test('adds an asset with a photo', async ({ page }) => {
  // The default 30s has intermittently not been enough time for the
  // Save click's awaited photo upload + row insert to finish against the
  // free-tier e2e project - the button just stays disabled longer than
  // usual rather than anything actually being broken.
  test.setTimeout(60_000);

  const assetName = `E2E photo asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();

  await page.goto('/#/register');
  // Supabase's auth listener fires more than once on a fresh load (its own
  // startup sequence, not something this suite tries to fix - see the app
  // code caveat in this PR), each re-render replacing the whole register
  // view. Letting the network settle first avoids racing an interaction
  // against one of those redraws.
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Add New Asset' }).click();
  await expect(page).toHaveURL(/#\/capture$/);

  await page.getByLabel('Asset name').fill(assetName);
  // exact: true - "Description" would otherwise substring-match the New
  // repair form's "Repair description" field, also present on this page.
  await page.getByLabel('Description', { exact: true }).fill('Created by a photo e2e test.');
  // The input is hidden and driven by the "Add photo" button (see
  // CLAUDE.md's camera notes), so it's addressed directly rather than by
  // label. This stubs the *file* Chrome's capture="environment" would
  // hand back, not the camera itself - see the e2e limitations note.
  await page.locator('#photo-input').setInputFiles(FIXTURE_PHOTO);
  await expect(page.getByAltText('Photo 1')).toBeVisible();

  await page.getByRole('button', { name: 'Save asset' }).click();
  await expect(page).toHaveURL(/#\/register$/);

  let photoPath;
  try {
    // The path lives on the photo's own row - assets carries no photo
    // column since 0005.
    await expect
      .poll(
        async () => {
          const { data } = await supabase
            .from('assets')
            .select('id, asset_photos(storage_path)')
            .eq('asset_name', assetName)
            .maybeSingle();
          photoPath = data?.asset_photos?.[0]?.storage_path;
          return photoPath ?? null;
        },
        { timeout: 15_000, message: 'asset with a photo never reached Supabase' }
      )
      .not.toBeNull();

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(photoPath, 60);
    expect(signedUrlError).toBeNull();
    expect(signedUrlData.signedUrl).toBeTruthy();
  } finally {
    await supabase.from('assets').delete().eq('asset_name', assetName);
    if (photoPath) {
      await supabase.storage.from(PHOTO_BUCKET).remove([photoPath]);
    }
  }
});
