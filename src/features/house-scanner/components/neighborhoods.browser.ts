import { expect, test } from '@playwright/test';
import neighborhoods from '@/features/house-scanner/assets/neighborhoods.json' with {
  type: 'json',
};
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';

test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.goto('/shellter/listings');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(page.getByRole('article')).toHaveCount(
    SYNTHETIC_SNAPSHOT.listings.length,
  );
});

test('the complete catalog retains zero-match selections and Back restores the unassigned choice', async ({
  page,
}) => {
  const unused = neighborhoods.find(
    ({ id }) =>
      !SYNTHETIC_SNAPSHOT.listings.some(
        (listing) => listing.neighborhood?.id === id,
      ),
  );
  if (!unused) throw new Error('The demo needs a neighborhood with no homes.');
  const unassignedCount = SYNTHETIC_SNAPSHOT.listings.filter(
    (listing) => !listing.neighborhood,
  ).length;
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: /^Filters(?: \(\d+\))?$/ }).click();
  const input = dialog.getByRole('combobox', {
    name: 'Neighborhoods',
    exact: true,
  });
  await input.click();
  await expect(page.getByRole('option')).toHaveCount(96);
  await input.fill(unused.name);
  await page.getByRole('option', { name: unused.name, exact: true }).click();
  await input.press('Escape');
  await dialog
    .getByRole('button', { name: 'Show 0 homes', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  const selectedUrl = page.url();

  await page.getByRole('button', { name: /^Filters(?: \(\d+\))?$/ }).click();
  await expect(dialog.locator('.mantine-Pill-label')).toHaveText([unused.name]);
  await input.click();
  await expect(page.getByRole('option')).toHaveCount(96);
  await input.press('Escape');
  await dialog
    .getByRole('checkbox', {
      name: 'Include homes with no neighborhood assigned',
      exact: true,
    })
    .check();
  await dialog
    .getByRole('button', { name: `Show ${unassignedCount} homes`, exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(unassignedCount);
  const unassignedUrl = page.url();
  expect(unassignedUrl).not.toBe(selectedUrl);

  await page.goBack();
  await expect(page).toHaveURL(selectedUrl);
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(unassignedUrl);
  await expect(page.getByRole('article')).toHaveCount(unassignedCount);
  await page.getByRole('button', { name: /^Filters(?: \(\d+\))?$/ }).click();
  await expect(
    dialog.getByRole('checkbox', {
      name: 'Include homes with no neighborhood assigned',
      exact: true,
    }),
  ).toBeChecked();
  await dialog
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(input).toHaveValue('');
  await expect(
    dialog.getByRole('checkbox', {
      name: 'Include homes with no neighborhood assigned',
      exact: true,
    }),
  ).not.toBeChecked();
  await dialog
    .getByRole('button', {
      name: `Show ${SYNTHETIC_SNAPSHOT.listings.length} homes`,
      exact: true,
    })
    .click();
  await expect(page.getByRole('article')).toHaveCount(
    SYNTHETIC_SNAPSHOT.listings.length,
  );
});

test('multiple neighborhoods show their official names and survive a reload', async ({
  page,
}) => {
  const assigned = SYNTHETIC_SNAPSHOT.listings.flatMap((listing) =>
    listing.neighborhood ? [listing.neighborhood] : [],
  );
  const [first, second] = assigned;
  if (!first || !second || first.id === second.id)
    throw new Error(
      'The demo needs homes in two distinct official neighborhoods.',
    );
  await page.getByRole('button', { name: /^Filters(?: \(\d+\))?$/ }).click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('combobox', {
    name: 'Neighborhoods',
    exact: true,
  });
  for (const neighborhood of [first, second]) {
    await input.fill(neighborhood.name);
    await page
      .getByRole('option', { name: neighborhood.name, exact: true })
      .click();
  }
  await input.press('Escape');
  const expectedCount = SYNTHETIC_SNAPSHOT.listings.filter(
    (listing) =>
      listing.neighborhood &&
      [first.id, second.id].includes(listing.neighborhood.id),
  ).length;
  await dialog
    .getByRole('button', { name: `Show ${expectedCount} homes`, exact: true })
    .click();
  await expect(page.getByRole('article')).toHaveCount(expectedCount);
  for (const neighborhood of [first, second]) {
    const listing = SYNTHETIC_SNAPSHOT.listings.find(
      (listing) => listing.neighborhood?.id === neighborhood.id,
    );
    if (!listing) throw new Error('Missing demo home.');
    const card = page.getByRole('article', {
      name: listing.title,
      exact: true,
    });
    await expect(
      card
        .getByText(new RegExp(` · ${neighborhood.name}$`))
        .filter({ visible: true }),
    ).toBeVisible();
  }
  const selectedUrl = page.url();
  await page.reload();
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(page).toHaveURL(selectedUrl);
  await expect(page.getByRole('article')).toHaveCount(expectedCount);
  await page.getByRole('button', { name: /^Filters(?: \(\d+\))?$/ }).click();
  await expect(dialog.locator('.mantine-Pill-label')).toHaveText([
    first.name,
    second.name,
  ]);
});
