import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

test('logs a repair, edits it, and marks it complete', async ({ page }) => {
  const assetName = `E2E repair asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();

  await page.goto('/#/register');
  await page.getByRole('button', { name: 'Add New Asset' }).click();
  await page.getByLabel('Asset name').fill(assetName);
  // exact: true - "Description" would otherwise substring-match the New
  // repair form's "Repair description" field, also present on this page.
  await page.getByLabel('Description', { exact: true }).fill('Created by a repair-workflow e2e test.');
  await page.getByRole('button', { name: 'Save asset' }).click();
  await expect(page).toHaveURL(/#\/register$/);

  try {
    // The default (desktop-width) Chromium viewport shows the table layout,
    // not the phone-width card list - a table row, not a button, is what's
    // actually visible and clickable here.
    await page.getByRole('row', { name: assetName }).click();
    await expect(page).toHaveURL(/#\/asset\//);

    await page.getByRole('button', { name: 'New repair' }).click();
    await page.getByLabel('Repair description').fill('Armrest is cracked.');
    await page.getByRole('button', { name: 'Save repair' }).click();

    // Scoped to the repair's own list item - "To do" alone also matches
    // the repairs sort dropdown's <option>To do</option> elsewhere on
    // this page.
    const repairItem = page.getByRole('listitem').filter({ hasText: 'Armrest is cracked' });
    await expect(repairItem.getByText('Armrest is cracked.')).toBeVisible();
    await expect(repairItem.getByText('To do')).toBeVisible();

    // Scoped - "Edit" alone also matches the asset's own Edit button, and
    // the edit textarea's own "Repair description" label also matches the
    // (hidden but still present) New repair form's identical label.
    await repairItem.getByRole('button', { name: 'Edit' }).click();
    await repairItem.getByLabel('Repair description').fill('Armrest is cracked and needs replacing.');
    await page.getByRole('button', { name: 'Save repair' }).click();
    await expect(repairItem.getByText('Armrest is cracked and needs replacing.')).toBeVisible();

    await page.getByRole('button', { name: 'Mark as complete' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(repairItem.getByText('Repair completed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as complete' })).toHaveCount(0);
  } finally {
    await supabase.from('assets').delete().eq('asset_name', assetName);
  }
});
