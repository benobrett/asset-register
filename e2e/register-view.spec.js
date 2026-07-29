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
      // Punctuation and LIKE wildcards on purpose - the search test below
      // relies on this description containing characters that are syntax
      // to PostgREST (comma, parens) and wildcards to Postgres (%, _).
      { name: `${prefix} Zulu`, description: 'Squeaky wheel (50% worn), 30_40cm rim.' },
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

  // Several of these are syntax in PostgREST's filter grammar or
  // wildcards in Postgres LIKE. A comma used to abort the query with
  // "failed to parse logic tree", which the view then reported as being
  // offline. Driven through the real UI and database, since the bug was
  // entirely in how the two of them meet.
  test('handles punctuation and wildcard characters in the search term', async ({ page }) => {
    await page.goto('/#/register');
    const search = page.getByPlaceholder('Search assets…');
    const punctuated = page.getByRole('row', { name: `${prefix} Zulu` });
    // Scoped to the table: both layouts always render, so the empty
    // message exists twice in the DOM.
    const noResults = page.locator('#asset-table-body').getByText('No assets found.');

    // Searching is debounced by 250ms, so filling the box and asserting
    // immediately can pass against the *previous* render - the query the
    // fill triggers hasn't run yet. Every step below therefore moves
    // between two visibly different states, so each assertion can only
    // be satisfied by the search it's actually testing.
    const searchFrom = async (settled, term) => {
      await search.fill(settled);
      await expect(noResults).toBeVisible();
      await search.fill(term);
    };

    // Each of these is literally present in Zulu's description
    // ("Squeaky wheel (50% worn), 30_40cm rim."), so each has to come
    // back as a match rather than an error. The comma is the one that
    // used to break the query outright.
    for (const term of ['worn), 30', '(50% worn)', '30_40cm', 'wheel (50%']) {
      await searchFrom('zzz-no-such-asset', term);
      await expect(punctuated).toBeVisible();
      await expect(page.getByRole('alert')).toBeHidden();
    }

    // ...and % must not act as a wildcard. "Z%u" is not literally in the
    // name, so this has to find nothing - whereas an unescaped % would
    // stand in for "ul" and match Zulu.
    await search.fill(`${prefix} Zulu`);
    await expect(punctuated).toBeVisible();
    await search.fill(`${prefix} Z%u`);
    await expect(noResults).toBeVisible();
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
  const assetName = `E2E delete asset ${Date.now()}`;
  const supabase = await createTestSupabaseClient();

  const { data: asset, error } = await supabase
    .from('assets')
    .insert({ asset_name: assetName, description: 'Created for the register-delete e2e test.' })
    .select()
    .single();
  if (error) throw error;

  // Outstanding, not completed. The old version of this test had to use
  // completed repairs to dodge #67, where the "🔧 Repair logged" badge
  // overlapped the register's delete button and swallowed its clicks.
  // Deleting now happens on the asset's own page, so the badge is
  // irrelevant and the more realistic case is testable again.
  const { error: repairsError } = await supabase.from('asset_repairs').insert([
    { asset_id: asset.id, description: 'First repair.', created_by_email: 'seed@example.com' },
    { asset_id: asset.id, description: 'Second repair.', created_by_email: 'seed@example.com' },
  ]);
  if (repairsError) throw repairsError;

  let deleted = false;
  try {
    await page.goto('/#/register');
    await page.getByPlaceholder('Search assets…').fill(assetName);

    // Wait for the debounced search to have actually rendered its result
    // before touching anything - its 250ms timer can otherwise still be
    // pending and re-render the list out from under the click.
    const row = page.getByRole('row', { name: assetName });
    await expect(row).toHaveCount(1);

    // Deleting lives on the asset's own page (#67): a destructive action
    // sitting one stray tap away in a scanning list was both unreachable
    // by touch and easy to hit by accident.
    await row.click();
    await expect(page).toHaveURL(/#\/asset\//);

    await page.getByRole('button', { name: 'Delete asset' }).click();
    await expect(page.locator('.modal-message')).toContainText('2 repair records');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    // Back to the register, with the asset gone from it.
    await expect(page).toHaveURL(/#\/register$/);
    await page.getByPlaceholder('Search assets…').fill(assetName);
    await expect(page.getByRole('row', { name: assetName })).toHaveCount(0);
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
