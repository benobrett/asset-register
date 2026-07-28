import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

test('adds a comment, updates the preview, and expands/collapses the thread', async ({ page }) => {
  const assetName = `E2E comment asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();

  await page.goto('/#/register');
  await page.getByRole('button', { name: 'Add New Asset' }).click();
  await page.getByLabel('Asset name').fill(assetName);
  // exact: true - "Description" would otherwise substring-match the New
  // repair form's "Repair description" field, also present on this page.
  await page.getByLabel('Description', { exact: true }).fill('Created by a repair-comments e2e test.');
  await page.getByRole('button', { name: 'Save asset' }).click();
  await expect(page).toHaveURL(/#\/register$/);

  try {
    // The default (desktop-width) Chromium viewport shows the table layout,
    // not the phone-width card list - a table row, not a button, is what's
    // actually visible and clickable here.
    await page.getByRole('row', { name: assetName }).click();
    await expect(page).toHaveURL(/#\/asset\//);

    await page.getByRole('button', { name: 'New repair' }).click();
    await page.getByLabel('Repair description').fill('Gate hinge is squeaking.');
    await page.getByRole('button', { name: 'Save repair' }).click();

    // Scoped to this repair's own list item - other repair items (were
    // there any) would also have their own identically-labelled Comment
    // button and comment textarea.
    const repairItem = page.getByRole('listitem').filter({ hasText: 'Gate hinge is squeaking' });

    // Collapsed by default - no comments yet, so no preview line either.
    await expect(repairItem.getByRole('button', { name: 'Comment' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(repairItem.locator('.repair-comment-preview')).toHaveCount(0);

    await repairItem.getByRole('button', { name: 'Comment' }).click();
    await expect(repairItem.getByRole('button', { name: 'Comment' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(repairItem.getByLabel('Add a comment')).toBeVisible();

    await repairItem.getByLabel('Add a comment').fill('Oiled the hinge, should be fine now.');
    await repairItem.getByRole('button', { name: 'Save' }).click();

    // In the thread, still expanded - the test account has a name on file
    // (see migrations/e2e-seed-test-user.sql), so it's shown by name, not
    // by email.
    await expect(repairItem.getByText('Oiled the hinge, should be fine now.')).toBeVisible();
    await expect(repairItem.getByText('Test User', { exact: false })).toBeVisible();

    // Collapse - two "Close" controls exist in the expanded panel (an
    // icon-only one in the header, a text one by Save), either does the
    // same thing.
    await repairItem.getByRole('button', { name: 'Close' }).first().click();
    await expect(repairItem.getByRole('button', { name: 'Comment' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    // The preview line takes over once collapsed, showing the same latest
    // comment and author.
    await expect(repairItem.locator('.repair-comment-preview')).toContainText(
      'Oiled the hinge, should be fine now.'
    );
    await expect(repairItem.locator('.repair-comment-preview')).toContainText('Test User');
  } finally {
    await supabase.from('assets').delete().eq('asset_name', assetName);
  }
});

test("falls back to the commenter's email when no name is on file", async ({ page }) => {
  const assetName = `E2E comment fallback asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();

  // Seeded directly rather than through the UI: the UI always stamps the
  // signed-in account's own name onto a comment it creates, and the test
  // account has one on file - there's no way to produce a null-name
  // comment through the app itself, only by inserting one directly.
  const { data: asset, error: assetError } = await supabase
    .from('assets')
    .insert({
      asset_name: assetName,
      description: 'Seeded directly for the comment-fallback e2e test.',
    })
    .select()
    .single();
  if (assetError) throw assetError;

  const { data: repair, error: repairError } = await supabase
    .from('asset_repairs')
    .insert({
      asset_id: asset.id,
      description: 'Fence post is loose.',
      created_by_email: 'legacy@example.com',
    })
    .select()
    .single();
  if (repairError) throw repairError;

  const { error: commentError } = await supabase.from('repair_comments').insert({
    repair_id: repair.id,
    comment: 'Left by an account with no name on file.',
    created_by_email: 'legacy@example.com',
    created_by_name: null,
  });
  if (commentError) throw commentError;

  try {
    await page.goto(`/#/asset/${asset.id}`);

    const repairItem = page.getByRole('listitem').filter({ hasText: 'Fence post is loose' });
    await expect(repairItem.locator('.repair-comment-preview')).toContainText('legacy@example.com');

    await repairItem.getByRole('button', { name: 'Comment' }).click();
    await expect(repairItem.getByText('Left by an account with no name on file.')).toBeVisible();
    await expect(repairItem.getByText('legacy@example.com')).toBeVisible();
  } finally {
    await supabase.from('assets').delete().eq('id', asset.id);
  }
});
