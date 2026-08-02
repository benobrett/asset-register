import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

const PHOTO_FIXTURE = 'e2e/fixtures/test-photo.png';

// One asset with three photos, reused by every test here - capturing and
// syncing them is slow, and none of these mutate it.
let supabase;
let assetId;
const assetName = `E2E lightbox asset ${Date.now()}`;

test.beforeAll(async ({ browser }) => {
  supabase = await createTestSupabaseClient();
  const page = await browser.newPage();

  await page.goto('/#/register');
  await page.getByRole('button', { name: 'Add New Asset' }).click();
  await page.getByLabel('Asset name').fill(assetName);
  await page.getByLabel('Description', { exact: true }).fill('Created for the lightbox e2e test.');
  for (let i = 0; i < 3; i += 1) {
    await page.locator('#photo-input').setInputFiles(PHOTO_FIXTURE);
    await expect(page.locator('.photo-grid-item')).toHaveCount(i + 1);
  }
  await page.getByRole('button', { name: 'Save asset' }).click();
  await expect(page).toHaveURL(/#\/register$/);

  const { data } = await supabase
    .from('assets')
    .select('id')
    .eq('asset_name', assetName)
    .single();
  assetId = data.id;

  await expect
    .poll(
      async () => {
        const { data: photos } = await supabase
          .from('asset_photos')
          .select('id')
          .eq('asset_id', assetId);
        return photos?.length ?? 0;
      },
      { timeout: 20_000, message: 'photos never reached Supabase' }
    )
    .toBe(3);

  await page.close();
});

test.afterAll(async () => {
  if (supabase && assetId) await supabase.from('assets').delete().eq('id', assetId);
});

async function openViewer(page) {
  const thumbnails = page.locator('.photo-thumb-button');
  await expect(thumbnails.first()).toBeVisible({ timeout: 15000 });
  await thumbnails.first().click();
  const viewer = page.getByRole('dialog', { name: 'Photo viewer' });
  await expect(viewer).toBeVisible();
  return viewer;
}

test('opens a photo full-screen and closes on the button, Escape and the backdrop', async ({
  page,
}) => {
  await page.goto(`/#/asset/${assetId}`);
  const viewer = page.getByRole('dialog', { name: 'Photo viewer' });

  // The close control is labelled, not just an icon - that's the point of
  // it, so assert on the text rather than a class.
  await openViewer(page);
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toHaveCount(0);

  await openViewer(page);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // Backdrop, meaning the area outside the dialog itself.
  await openViewer(page);
  await page.locator('.lightbox-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(viewer).toHaveCount(0);
});

test('steps between photos and shows the position', async ({ page }) => {
  await page.goto(`/#/asset/${assetId}`);
  await openViewer(page);

  const position = page.locator('.lightbox-position');
  await expect(position).toHaveText('1 of 3');

  await page.getByRole('button', { name: 'Next photo' }).click();
  await expect(position).toHaveText('2 of 3');

  await page.getByRole('button', { name: 'Previous photo' }).click();
  await expect(position).toHaveText('1 of 3');

  // Wraps rather than dead-ending, so there's no state where a control
  // is visible but does nothing.
  await page.getByRole('button', { name: 'Previous photo' }).click();
  await expect(position).toHaveText('3 of 3');
});

test('leaves the page behind untouched and returns focus to the thumbnail', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 500 });
  await page.goto(`/#/asset/${assetId}`);
  await expect(page.locator('.photo-thumb-button').first()).toBeVisible({ timeout: 15000 });

  // Stamped on the live node - a re-render would replace it, taking this
  // with it, so it surviving proves the view wasn't redrawn.
  await page.evaluate(() => {
    document.querySelector('#app').dataset.untouchedMarker = 'original';
  });
  await page.evaluate(() => window.scrollTo(0, 150));

  // Read before opening: the viewer pins the body, so window.scrollY
  // reads 0 from that point on.
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);

  // Dispatched in-page rather than via Playwright's click: its
  // actionability check scrolls the target into view first, and with the
  // sticky header overlapping the thumbnail that moves the page to the
  // top - the harness would be the thing changing the scroll position
  // this test is about.
  await page.evaluate(() => document.querySelector('.photo-thumb-button').click());

  const viewer = page.getByRole('dialog', { name: 'Photo viewer' });
  await expect(viewer).toBeVisible();

  // Genuinely frozen while open, not merely overlaid.
  const maxScrollWhileOpen = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight
  );
  expect(maxScrollWhileOpen).toBe(0);

  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await expect(page.locator('#app')).toHaveAttribute('data-untouched-marker', 'original');
  expect(
    await page.evaluate(() => document.activeElement?.classList?.contains('photo-thumb-button'))
  ).toBe(true);
});

test('a confirm dialog appears above the viewer, not behind it', async ({ page }) => {
  await page.goto(`/#/asset/${assetId}`);
  await openViewer(page);

  // Deleting is the confirm this screen offers. The viewer covers the
  // page, so the button is driven in-page - the point is the stacking,
  // not whether it can be clicked through an overlay.
  await page.evaluate(() => document.querySelector('#delete-asset-button').click());

  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();

  // Both are on screen; the confirm has to win. Comparing the computed
  // stacking directly, rather than trusting DOM order.
  const ordering = await page.evaluate(() => {
    const zIndexOf = (selector) =>
      Number(getComputedStyle(document.querySelector(selector)).zIndex);
    return {
      lightbox: zIndexOf('.lightbox-backdrop'),
      confirm: zIndexOf('.modal-backdrop'),
      chrome: zIndexOf('.app-chrome'),
    };
  });
  expect(ordering.confirm).toBeGreaterThan(ordering.lightbox);
  expect(ordering.lightbox).toBeGreaterThan(ordering.chrome);

  await page.getByRole('button', { name: 'Cancel' }).click();
});
