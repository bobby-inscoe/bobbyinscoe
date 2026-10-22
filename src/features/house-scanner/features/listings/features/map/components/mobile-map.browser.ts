import { expect, test } from '@playwright/test';

const STREET_STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#e8e6df' },
    },
  ],
};

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ context, page }) => {
  test.skip(test.info().project.name !== 'narrow');
  await context.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.route('https://tiles.openfreemap.org/styles/liberty', (route) =>
    route.fulfill({ json: STREET_STYLE }),
  );
  await page.route('https://server.arcgisonline.com/**', (route) =>
    route.fulfill({ body: PIXEL_PNG, contentType: 'image/png' }),
  );
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
});

test('mobile map fills the viewport and List restores the full listing view', async ({
  page,
}) => {
  const mapToggle = page.getByRole('button', { name: 'Map', exact: true });
  await mapToggle.click();
  const shell = page.locator('[aria-label="Map browsing"]');
  await expect(shell).toBeVisible();
  await expect(
    shell.getByRole('button', { name: 'List', exact: true }),
  ).toBeVisible();
  await expect(
    shell.getByRole('button', { name: /^Filters(?: \(\d+\))?$/ }),
  ).toBeVisible();
  await expect(
    shell.getByRole('button', { name: 'Select', exact: true }),
  ).toBeVisible();
  await shell.getByRole('button', { name: 'Map options' }).click();
  await expect(page.getByRole('group', { name: 'Basemap' })).toBeVisible();
  await shell.getByRole('button', { name: 'Map options' }).click();
  await expect(page.getByLabel('Listing map')).toBeVisible();

  const viewport = page.viewportSize();
  const box = await shell.boundingBox();
  if (!viewport || !box) throw new Error('Missing mobile map viewport.');
  expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - viewport.height)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator('body')
      .evaluate((body) => getComputedStyle(body).overflow),
  ).toBe('hidden');
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);

  const smallControls = await shell
    .locator('button:visible, a[role="button"]:visible')
    .evaluateAll((controls) =>
      controls
        .map((control) => {
          const { width, height } = control.getBoundingClientRect();
          return {
            name: control.textContent || control.getAttribute('aria-label'),
            width: Math.round(width),
            height: Math.round(height),
          };
        })
        .filter(({ width, height }) => width < 44 || height < 44),
    );
  expect(smallControls).toEqual([]);

  await shell.getByRole('button', { name: /^Filters(?: \(\d+\))?$/ }).click();
  const filters = page.getByRole('dialog', { name: 'Filters' });
  await expect(filters).toBeVisible();
  await expect(shell).toBeVisible();
  await filters.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(filters).toHaveCount(0);

  await shell.getByRole('button', { name: /^Filters(?: \(\d+\))?$/ }).click();
  const notOnMap = page.getByRole('checkbox', {
    name: 'Not on the map only',
  });
  await notOnMap.check();
  await page.getByRole('button', { name: 'Show 3 homes', exact: true }).click();
  await expect(shell.getByText('3 homes', { exact: true })).toBeVisible();
  await shell.getByRole('button', { name: 'Map options' }).click();
  await page
    .getByRole('button', { name: 'Not located (3)', exact: true })
    .click();
  const unlocated = page.getByRole('dialog', { name: 'Not located (3)' });
  await expect(unlocated.getByRole('button')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(unlocated).toHaveCount(0);
  await shell.getByRole('button', { name: 'Filters (1)', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Not on the map only' }).uncheck();
  await page.getByRole('button', { name: 'Show 5 homes', exact: true }).click();

  await page.getByRole('button', { name: /^2 homes at this point/ }).click();
  await page.getByRole('button', { name: 'Home 2', exact: true }).click();
  const preview = page.getByRole('article', {
    name: 'Selected home: Example detached home',
    exact: true,
  });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Details', exact: true }).click();
  const details = page.getByRole('dialog', {
    name: 'Example detached home',
    exact: true,
  });
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(preview).toBeVisible();

  await shell.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('[aria-label="Map browsing"]')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(5);
  await expect(mapToggle).toBeFocused();
  const more = page.getByRole('button', { name: 'More', exact: true });
  await expect(more).toBeEnabled();
  expect(await more.evaluate((button) => button.closest('[inert]'))).toBeNull();
  await more.click();
  await page.keyboard.press('Escape');
  expect(
    await page.locator('body').evaluate((body) => body.style.overflow),
  ).toBe('');

  await mapToggle.click();
  await expect(shell).toBeVisible();
  await page.goBack();
  await expect(shell).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(5);
  expect(
    await page.locator('body').evaluate((body) => body.style.overflow),
  ).toBe('');
});
