import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

test('sets condition and a note on capture, then shows both on the asset detail page', async ({
  page,
}) => {
  const assetName = `E2E condition asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();

  await page.goto('/#/register');
  await page.getByRole('button', { name: 'Add New Asset' }).click();
  await page.getByLabel('Asset name').fill(assetName);
  // exact: true - "Description" would otherwise substring-match the New
  // repair form's "Repair description" field, also present on this page.
  await page.getByLabel('Description', { exact: true }).fill('Created by a condition e2e test.');
  // exact: true - "Condition" would otherwise substring-match "Condition
  // note"'s label too.
  await page.getByLabel('Condition', { exact: true }).selectOption('poor');
  await page.getByLabel('Condition note').fill('Rust on the left hinge, still closes fine.');
  await page.getByRole('button', { name: 'Save asset' }).click();
  await expect(page).toHaveURL(/#\/register$/);

  try {
    await page.getByRole('row', { name: assetName }).click();
    await expect(page).toHaveURL(/#\/asset\//);

    await expect(page.getByText('Poor', { exact: true })).toBeVisible();
    await expect(page.getByText('Rust on the left hinge, still closes fine.')).toBeVisible();
  } finally {
    await supabase.from('assets').delete().eq('asset_name', assetName);
  }
});

test('edits condition and note from the asset detail page', async ({ page }) => {
  const assetName = `E2E condition edit asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();

  const { data: asset, error } = await supabase
    .from('assets')
    .insert({ asset_name: assetName, description: 'Seeded for the condition-edit e2e test.' })
    .select()
    .single();
  if (error) throw error;

  try {
    await page.goto(`/#/asset/${asset.id}`);

    await expect(page.getByText('Not set')).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Condition', { exact: true }).selectOption('good');
    await page.getByLabel('Condition note').fill('Recently serviced.');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Good', { exact: true })).toBeVisible();
    await expect(page.getByText('Recently serviced.')).toBeVisible();

    const { data: updated } = await supabase
      .from('assets')
      .select('condition, condition_note')
      .eq('id', asset.id)
      .single();
    expect(updated.condition).toBe('good');
    expect(updated.condition_note).toBe('Recently serviced.');
  } finally {
    await supabase.from('assets').delete().eq('id', asset.id);
  }
});
