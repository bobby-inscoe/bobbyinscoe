import { expect, test } from '@playwright/test';

const prefix = '/shellter';
const balconyId = '00000000-0000-4000-8000-000000000010';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') await route.continue();
    else await route.abort('blockedbyclient');
  });
});

test('routed favorites survive details, Back, Forward and section changes', async ({
  page,
}) => {
  await page.goto(`${prefix}/favorites`);
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await page
    .getByRole('article', { name: 'Example balcony home', exact: true })
    .getByRole('button', { name: 'Example balcony home', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/listings/${balconyId}`));
  await expect(
    page.getByRole('dialog', { name: 'Example balcony home' }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/shellter\/favorites/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.goForward();
  await expect(
    page.getByRole('dialog', { name: 'Example balcony home' }),
  ).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add link', exact: true }).click();
  await expect(page).toHaveURL(/shellter\/add-link/);
  await page.goBack();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Leave demo' })).toBeVisible();
});

test('direct detail links require access and resolve independently of filters', async ({
  page,
}) => {
  await page.goto(`${prefix}/listings/${balconyId}?minPrice=999999999`);
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Example balcony home' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Example balcony home' }),
  ).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Back to listings', exact: true })
    .click();
  await expect(page).toHaveURL(/shellter\/listings(?:\?|$)/);
});

test('a missing direct detail has a safe Listings fallback', async ({
  page,
}) => {
  await page.goto(`${prefix}/listings/00000000-0000-4000-8000-999999999999`);
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(
    page.getByText('This home is unavailable in this household.'),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Back to Listings', exact: true })
    .click();
  await expect(page).toHaveURL(/shellter\/listings(?:\?|$)/);
  await expect(page.getByRole('article')).toHaveCount(5);
});

test('browser Back dismisses selection before leaving results', async ({
  page,
}) => {
  await page.goto(`${prefix}/listings`);
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(
    page.getByRole('checkbox', {
      name: 'Select Example balcony home',
      exact: true,
    }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/shellter\/listings(?:\?|$)/);
  await expect(
    page.getByRole('checkbox', {
      name: 'Select Example balcony home',
      exact: true,
    }),
  ).toHaveCount(0);
});

async function demoListings(page: import('@playwright/test').Page) {
  await page.goto(`${prefix}/listings`);
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
}

async function applyPrice(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Max price (SEK)' }).fill('3000000');
  await page.getByRole('button', { name: /^Show \d+ homes$/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'Filters', exact: true }),
  ).toHaveCount(0);
}

test('applying filters then reopening and cancelling keeps the committed filters', async ({
  page,
}) => {
  await demoListings(page);
  await applyPrice(page);
  const committedUrl = page.url();
  const count = await page.getByRole('article').count();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Max price (SEK)' }).fill('1');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(committedUrl);
  await expect(page.getByRole('article')).toHaveCount(count);
  await page.goBack();
  await expect(page.getByRole('article')).toHaveCount(5);
});

for (const dismiss of ['Cancel selection', 'browser Back'] as const) {
  test(`selection then filter Apply then ${dismiss} closes selection and keeps committed filters`, async ({
    page,
  }) => {
    await demoListings(page);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await applyPrice(page);
    const committedCount = await page.getByRole('article').count();
    expect(committedCount).toBeLessThan(5);
    if (dismiss === 'browser Back') await page.goBack();
    else
      await page
        .getByRole('button', { name: 'Cancel selection', exact: true })
        .click();
    await expect(
      page.getByRole('button', { name: 'Select', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(committedCount);
    await page.goBack();
    await expect(page.getByRole('article')).toHaveCount(5);
  });
}

for (const id of [balconyId, '00000000-0000-4000-8000-999999999999']) {
  test(`direct Favorites detail ${id} returns to Favorites`, async ({
    page,
  }) => {
    await page.goto(`${prefix}/listings/${id}?from=favorites`);
    await page
      .getByRole('button', { name: 'Explore the synthetic demo' })
      .click();
    await page.getByRole('button', { name: /^Back to favorites$/i }).click();
    await expect(page).toHaveURL(/shellter\/favorites(?:\?|$)/);
    await expect(page.getByRole('article')).toHaveCount(2);
  });
}
