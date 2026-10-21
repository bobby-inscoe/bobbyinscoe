import { expect, test } from '@playwright/test';

test('a large list mounts cards in batches while browsing controls work', async ({
  context,
  page,
}) => {
  await context.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.route(
    '**/src/features/house-scanner/mock/synthetic-household.ts*',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `
          const template = SYNTHETIC_SNAPSHOT.listings[0];
          SYNTHETIC_SNAPSHOT.listings = Array.from({ length: 500 }, (_, index) => ({
            ...template,
            id: index === 0 ? template.id : '10000000-0000-4000-8000-' + String(index).padStart(12, '0'),
            title: 'Home ' + index,
            sourceUrls: ['https://example.invalid/home/' + index],
          }));
          `,
      });
    },
  );
  await page.goto('/shellter/listings');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(page.getByRole('article')).toHaveCount(32);

  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Filters' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Select Home 0' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel selection' }).click();
  await expect(page.getByRole('article')).toHaveCount(32);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('article')).toHaveCount(64);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('combobox', { name: 'Sort homes' }).click();
  await page.getByRole('option', { name: 'Price: high to low' }).click();
  await expect(page.getByRole('article')).toHaveCount(32);
});
