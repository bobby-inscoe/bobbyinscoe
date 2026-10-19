import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.goto('/projects/house-scanner/listings');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(page.getByRole('article')).toHaveCount(5);
});

test('batch hide excludes household favorites and Undo restores the exact batch', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page
    .getByRole('button', { name: 'Select unsaved (3)', exact: true })
    .click();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(3);
  await expect(
    page.getByRole('checkbox', {
      name: 'Select Example balcony home',
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', {
      name: 'Select Example older listing',
      exact: true,
    }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Hide 3', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(
    page.getByText('3 homes hidden.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Select', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Undo hide (3)', exact: true })
    .click();
  await expect(page.getByRole('article')).toHaveCount(5);
  await expect(
    page.getByText('3 homes restored.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
});

test('explicitly hiding a saved home keeps its favorite and offers recovery through filters', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Select Example balcony home', exact: true })
    .check();
  await expect(
    page.getByText(
      '1 selected · Saves are yours; hiding is only for you · Includes 1 saved home',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Hide 1', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('radio', { name: 'Hidden only', exact: true }).check();
  await page.getByRole('button', { name: 'Show 1 homes', exact: true }).click();
  const hidden = page.getByRole('article', {
    name: 'Example balcony home',
    exact: true,
  });
  await expect(hidden).toBeVisible();
  await hidden.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('Saved by Demo Morgan', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Back to favorites' })
    .click();
  await page
    .getByRole('button', { name: 'Undo hide (1)', exact: true })
    .click();
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await page.getByRole('button', { name: 'Show 2 homes', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
});

test('applying filters removes excluded selections without adding new ones', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page
    .getByRole('button', { name: 'Select unsaved (3)', exact: true })
    .click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Not on the map only', exact: true })
    .check();
  await page.getByRole('button', { name: /Show \d+ homes/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await page.getByRole('button', { name: 'Show 5 homes', exact: true }).click();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
});

test('price sort keeps unknown prices last and browser Back restores order', async ({
  page,
}) => {
  await page.getByRole('combobox', { name: 'Sort homes', exact: true }).click();
  await page
    .getByRole('option', { name: 'Price: high to low', exact: true })
    .click();
  await expect(page.getByRole('article').first()).toHaveAttribute(
    'aria-label',
    'Example terrace home',
  );
  await expect(page.getByRole('article').last()).toHaveAttribute(
    'aria-label',
    'Example home needing details',
  );
  await page.goBack();
  await expect(page.getByRole('article').first()).toHaveAttribute(
    'aria-label',
    'Example balcony home',
  );
});
