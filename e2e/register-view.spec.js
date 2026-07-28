import { test, expect } from '@playwright/test';
import { createTestSupabaseClient } from './supabase-helper.js';

test.describe('search, sort, and the outstanding-repairs filter', () => {
  const prefix = `E2E register ${Date.now()}`;
  let supabase;
  let assetIds = [];

  // Seeded directly rather than through the capture UI - this issue is
  // about register.js's own search/sort/filter behaviour, not asset
  // creation (already covered elsewhere), and three assets with
  // controlled names/repair states would be slow and verbose to set up
  // by driving the form three times over.
  test.beforeAll(async () => {
    supabase = await createTestSupabaseClient();

    // Created in this order (Zulu, Alpha, Mike) so newest/oldest and
    // name-asc/desc sort differently from creation order, proving the
    // sort actually did something rather than just preserving insert order.
    const seed = [
      { name: `${prefix} Zulu`, description: 'Squeaky wheelbarrow wheel.' },
      { name: `${prefix} Alpha`, description: 'Rusted gate hinge.' },
      { name: `${prefix} Mike`, description: 'Cracked plant pot.' },
    ];

    for (const item of seed) {
      const { data, error } = await supabase
        .from('assets')
        .insert({ asset_name: item.name, description: item.description })
        .select()
        .single();
      if (error) throw error;
      assetIds.push(data.id);
    }

    // Alpha: one outstanding repair - should show under "Repairs" sort.
    // Mike: one repair, already completed - should NOT show (completed
    // repairs don't count as outstanding). Zulu: no repair at all -
    // should never show under "Repairs" either.
    const { error: repairsError } = await supabase.from('asset_repairs').insert([
      { asset_id: assetIds[1], description: 'Oil the hinge.', created_by_email: 'seed@example.com' },
      {
        asset_id: assetIds[2],
        description: 'Glue the pot.',
        created_by_email: 'seed@example.com',
        completed_at: new Date().toISOString(),
        completed_by_email: 'seed@example.com',
      },
    ]);
    if (repairsError) throw repairsError;
  });

  test.afterAll(async () => {
    if (supabase && assetIds.length) {
      await supabase.from('assets').delete().in('id', assetIds);
    }
  });

  test('search filters the list by name and by description', async ({ page }) => {
    await page.goto('/#/register');

    await page.getByPlaceholder('Search assets…').fill(`${prefix} Alpha`);
    await expect(page.getByRole('row', { name: `${prefix} Alpha` })).toBeVisible();
    await expect(page.getByRole('row', { name: `${prefix} Zulu` })).toHaveCount(0);

    // Matches on description too, not just the name field.
    await page.getByPlaceholder('Search assets…').fill('Rusted gate hinge');
    await expect(page.getByRole('row', { name: `${prefix} Alpha` })).toBeVisible();
    await expect(page.getByRole('row', { name: `${prefix} Zulu` })).toHaveCount(0);
  });

  test('sorts newest/oldest/name and applies the outstanding-repairs filter', async ({ page }) => {
    await page.goto('/#/register');
    // Scoped to just this test's three seeded assets - the register is
    // shared, so an unscoped row list could include unrelated real data.
    await page.getByPlaceholder('Search assets…').fill(prefix);
    // Waits for the debounced search to fully settle before touching the
    // sort dropdown - changing both close together would otherwise fire
    // two independent, unordered fetches (search's own debounce timer,
    // and the sort <select>'s immediate change handler) that can resolve
    // out of order and race each other for the final render.
    await expect(page.locator('#asset-table-body tr')).toHaveCount(3);

    const rows = page.locator('#asset-table-body tr');

    // Asserted via retrying locators, not a one-shot allTextContents()
    // snapshot - each selectOption() fires its own immediate (undebounced)
    // fetch, and reading the DOM before the previous one has resolved
    // would just be racing it.
    await page.getByLabel('Sort by').selectOption('name-asc');
    await expect(rows.nth(0)).toContainText('Alpha');
    await expect(rows.nth(1)).toContainText('Mike');
    await expect(rows.nth(2)).toContainText('Zulu');

    await page.getByLabel('Sort by').selectOption('name-desc');
    await expect(rows.nth(0)).toContainText('Zulu');
    await expect(rows.nth(1)).toContainText('Mike');
    await expect(rows.nth(2)).toContainText('Alpha');

    await page.getByLabel('Sort by').selectOption('oldest');
    await expect(rows.nth(0)).toContainText('Zulu');
    await expect(rows.nth(1)).toContainText('Alpha');
    await expect(rows.nth(2)).toContainText('Mike');

    await page.getByLabel('Sort by').selectOption('newest');
    await expect(rows.nth(0)).toContainText('Mike');
    await expect(rows.nth(1)).toContainText('Alpha');
    await expect(rows.nth(2)).toContainText('Zulu');

    // Repairs-only: Alpha has an outstanding repair, Mike's is already
    // complete, Zulu has none logged at all - only Alpha remains.
    await page.getByLabel('Sort by').selectOption('repairs');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('Alpha');
  });
});

test('deletes an asset, showing the repair-count confirmation and cascading its repairs', async ({
  page,
}) => {
  // The register view's quick-delete button only renders in the card-list
  // markup, not the table row - a narrow viewport is what actually makes
  // it visible/clickable (see CLAUDE.md's responsive layout note).
  await page.setViewportSize({ width: 480, height: 800 });

  const assetName = `E2E delete asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();

  const { data: asset, error } = await supabase
    .from('assets')
    .insert({ asset_name: assetName, description: 'Created for the register-delete e2e test.' })
    .select()
    .single();
  if (error) throw error;

  // Both repairs completed, not outstanding - filed #67 for a real bug:
  // the delete button only reveals on hover/focus (unreachable by touch
  // at all) and, when an asset HAS an outstanding repair, the "Repair
  // logged" badge visually overlaps and intercepts clicks meant for it.
  // Sidestepping that here since it's a UX decision, not an e2e-coverage
  // one - this still exercises the repair-count confirmation and cascade,
  // just not through an overlapping badge.
  const completedAt = new Date().toISOString();
  const { error: repairsError } = await supabase.from('asset_repairs').insert([
    {
      asset_id: asset.id,
      description: 'First repair.',
      created_by_email: 'seed@example.com',
      completed_at: completedAt,
      completed_by_email: 'seed@example.com',
    },
    {
      asset_id: asset.id,
      description: 'Second repair.',
      created_by_email: 'seed@example.com',
      completed_at: completedAt,
      completed_by_email: 'seed@example.com',
    },
  ]);
  if (repairsError) throw repairsError;

  let deleted = false;
  try {
    await page.goto('/#/register');
    await page.getByPlaceholder('Search assets…').fill(assetName);

    // The delete button only becomes clickable on :hover/:focus-within
    // (see #67), and starts pointer-events: none - meaning it can't even
    // be hovered as its OWN target (nothing to hit-test until it's
    // already visible). A real mouse doesn't need to: moving anywhere
    // over the row triggers the ancestor's :hover, which is what
    // actually reveals it - so hover the row itself first, then click
    // the now-visible button.
    const row = page.locator('.asset-list-item').filter({ hasText: assetName });
    const deleteButton = page.getByRole('button', { name: `Delete ${assetName}` });

    // Wait for the debounced search to have actually rendered its result
    // before touching anything. Otherwise its 250ms timer can still be
    // pending, fire mid-delete, and blank the list to "Loading…" - which
    // makes the post-delete "row is gone" assertion pass for the wrong
    // reason, before the delete has even completed.
    await expect(row).toHaveCount(1);

    await row.hover();
    await deleteButton.click();

    await expect(page.locator('.modal-message')).toContainText('2 repair records');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(row).toHaveCount(0);
    deleted = true;

    const { data: remainingAsset } = await supabase.from('assets').select('id').eq('id', asset.id);
    expect(remainingAsset).toHaveLength(0);
    const { data: remainingRepairs } = await supabase
      .from('asset_repairs')
      .select('id')
      .eq('asset_id', asset.id);
    expect(remainingRepairs).toHaveLength(0);
  } finally {
    if (!deleted) await supabase.from('assets').delete().eq('id', asset.id);
  }
});
