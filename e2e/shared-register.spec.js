import { test, expect } from '@playwright/test';
import { createTestSupabaseClient, createSecondUserClient } from './supabase-helper.js';

// Issue #97: photos uploaded by one user weren't visible to another.
//
// The real fault was that production had no Storage policy at all, so
// every upload 403'd, the photo stayed in the uploader's IndexedDB queue,
// and detail.js rendered it from the local blob. The app therefore looked
// completely correct to the only person who could never notice - and
// wrong to everybody else.
//
// **Read this before trusting a green run.** These specs run against the
// e2e project, which has always had the correct policy; they could not
// have caught #97, and cannot catch the same drift in production. What
// they do catch is a regression in the *intended* design - someone
// tightening a policy to be owner-scoped, or a code change that starts
// relying on local state where it should be reading shared state. Drift
// between the two projects is issue #100's problem, not a test's.
//
// Everything here asserts as a second, different account, because the
// whole class of bug is invisible from a single one.

const PHOTO_FIXTURE = 'e2e/fixtures/test-photo.png';
const PHOTO_BUCKET = 'asset-photos';

test.describe('the register is genuinely shared between users', () => {
  let supabase;
  let other;
  let assetId;
  const assetName = `E2E shared ${Date.now()}`;

  test.beforeAll(async () => {
    supabase = await createTestSupabaseClient();
    other = await createSecondUserClient();
  });

  test.afterAll(async () => {
    if (supabase && assetId) await supabase.from('assets').delete().eq('id', assetId);
  });

  test('a photo captured by one user is readable by another, from Storage', async ({ page }) => {
    await page.goto('/#/register');
    await page.getByRole('button', { name: 'Add New Asset' }).click();
    await page.getByLabel('Asset name').fill(assetName);
    await page.getByLabel('Description', { exact: true }).fill('Cross-user visibility check.');
    await page.locator('#photo-input').setInputFiles(PHOTO_FIXTURE);
    await expect(page.locator('.photo-grid-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save asset' }).click();
    await expect(page).toHaveURL(/#\/register$/);

    const { data: asset } = await supabase
      .from('assets')
      .select('id')
      .eq('asset_name', assetName)
      .single();
    assetId = asset.id;

    // The row reaching the database is not the point - the object
    // reaching Storage is. Under #97 the row was never written either,
    // because the upload threw first, but a policy that allowed insert
    // and denied select would produce a row and no readable file.
    let storagePath;
    await expect
      .poll(
        async () => {
          const { data } = await supabase
            .from('asset_photos')
            .select('storage_path')
            .eq('asset_id', assetId);
          storagePath = data?.[0]?.storage_path;
          return storagePath ?? null;
        },
        { timeout: 20_000, message: 'the photo never synced' }
      )
      .not.toBeNull();

    // The assertion that would have failed under #97's root cause, had
    // the e2e project shared production's configuration.
    const { data: signed, error: signError } = await other.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(storagePath, 60);
    expect(signError, 'a second user must be able to sign the photo URL').toBeNull();
    expect(signed?.signedUrl).toBeTruthy();

    const { data: blob, error: downloadError } = await other.storage
      .from(PHOTO_BUCKET)
      .download(storagePath);
    expect(downloadError, 'a second user must be able to download the photo').toBeNull();
    expect(blob.size).toBeGreaterThan(0);
  });

  test('a second user can read and write the asset, its repairs and its comments', async () => {
    // Depends on the asset created above; ordered within the describe.
    expect(assetId, 'the previous test must have created an asset').toBeTruthy();

    const seen = await other.from('assets').select('id, asset_name').eq('id', assetId).single();
    expect(seen.error).toBeNull();
    expect(seen.data.asset_name).toBe(assetName);

    const edit = await other
      .from('assets')
      .update({ description: 'Edited by a different user.' })
      .eq('id', assetId);
    expect(edit.error, 'a second user must be able to edit the asset').toBeNull();

    const repairId = crypto.randomUUID();
    const logged = await other.from('asset_repairs').insert({
      id: repairId,
      asset_id: assetId,
      description: 'Repair logged by the second user',
      created_by_email: 'second@example.com',
    });
    expect(logged.error).toBeNull();

    const completed = await supabase
      .from('asset_repairs')
      .update({ completed_at: new Date().toISOString(), completed_by_email: 'first@example.com' })
      .eq('id', repairId);
    expect(completed.error, 'the first user must be able to complete it').toBeNull();

    // created_by_name is snapshotted at write time rather than joined from
    // profiles at read time. That matters: profiles is scoped per-user, so
    // a live join would silently blank the author's name for everyone
    // except its owner - the same class of bug as #97, one table over.
    const commented = await other.from('repair_comments').insert({
      repair_id: repairId,
      comment: 'Comment from the second user',
      created_by_email: 'second@example.com',
      created_by_name: 'Second User',
    });
    expect(commented.error).toBeNull();

    const { data: comments } = await supabase
      .from('repair_comments')
      .select('comment, created_by_name')
      .eq('repair_id', repairId);
    expect(comments[0].created_by_name).toBe('Second User');
  });

  test('profiles stays scoped to its owner - the fix must not widen it', async () => {
    const { data: mine } = await supabase.auth.getUser();

    const { data: theirs, error } = await other
      .from('profiles')
      .select('id, first_name')
      .eq('id', mine.user.id);

    // RLS filters rather than erroring, so "blocked" is an empty result.
    expect(error).toBeNull();
    expect(theirs, 'one user must not be able to read another profile row').toEqual([]);

    const { data: all } = await other.from('profiles').select('id');
    expect(all.length, 'a user should see at most their own profile row').toBeLessThanOrEqual(1);
  });

  test('photos are not readable without a session', async ({ request }) => {
    expect(assetId, 'the first test must have created an asset').toBeTruthy();
    const { data } = await supabase
      .from('asset_photos')
      .select('storage_path')
      .eq('asset_id', assetId);
    const storagePath = data?.[0]?.storage_path;
    expect(storagePath).toBeTruthy();

    // The check that catches an over-correction. Making the bucket public
    // would make every assertion above pass while removing access control
    // entirely, so assert the unauthenticated path is still refused.
    const base = process.env.VITE_SUPABASE_URL.replace(/\/$/, '');
    const anonymous = await request.get(`${base}/storage/v1/object/${PHOTO_BUCKET}/${storagePath}`);
    expect(
      anonymous.status(),
      'an unauthenticated request must not be able to fetch a photo'
    ).toBeGreaterThanOrEqual(400);
  });
});
