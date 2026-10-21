import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.route('https://tiles.openfreemap.org/styles/liberty', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#e8e6df' },
          },
        ],
      },
    }),
  );
  // Stack the two demo homes so the map shows one "2 homes at this point" pin.
  await page.route(
    '**/src/features/house-scanner/mock/synthetic-household.ts*',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: `${await response.text()}
          SYNTHETIC_SNAPSHOT.listings.find((home) => home.title === 'Example detached home').coordinates =
            SYNTHETIC_SNAPSHOT.listings.find((home) => home.title === 'Example balcony home').coordinates;
        `,
      });
    },
  );
  await page.goto('/shellter/listings');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /^2 homes at this point/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
});

async function openOptionsOnPhone(page: import('@playwright/test').Page) {
  if (test.info().project.name === 'narrow')
    await page.getByRole('button', { name: 'Map options' }).click();
}

test('map capture reviews exact homes, protects favorites, hides and undoes the batch', async ({
  page,
}) => {
  await openOptionsOnPhone(page);
  await page
    .getByRole('button', { name: 'Review this area', exact: true })
    .click();
  const review = page.getByRole('dialog', {
    name: 'Review homes in this view',
  });
  await expect(review).toBeVisible();
  await expect(review.getByRole('checkbox')).toHaveCount(2);
  await expect(
    review.getByRole('checkbox', { name: 'Select Example balcony home' }),
  ).not.toBeChecked();
  await expect(
    review.getByRole('checkbox', { name: 'Select Example detached home' }),
  ).toBeChecked();
  await expect(
    review.getByRole('button', { name: 'Hide 1', exact: true }),
  ).toBeVisible();
  await review.getByRole('button', { name: 'Hide 1', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^Example balcony home:/ }),
  ).toBeVisible();
  await expect(page.getByText('1 home hidden.', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Undo hide (1)', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /^2 homes at this point/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(5);
});

test('review can be cancelled and Back closes map selection without hiding', async ({
  page,
}) => {
  await openOptionsOnPhone(page);
  const capture = page.getByRole('button', {
    name: 'Review this area',
    exact: true,
  });
  await capture.click();
  const review = page.getByRole('dialog', {
    name: 'Review homes in this view',
  });
  await review
    .getByRole('checkbox', { name: 'Select Example balcony home' })
    .check();
  await expect(review.getByRole('status')).toContainText(
    'Includes 1 saved home',
  );
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review).toHaveCount(0);
  await capture.click();
  await expect(
    review.getByRole('checkbox', { name: 'Select Example balcony home' }),
  ).not.toBeChecked();
  await page.goBack();
  await expect(review).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Select', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(5);
});
