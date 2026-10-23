import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname))
      await route.continue();
    else if (url.href === 'https://tiles.openfreemap.org/styles/liberty')
      await route.fulfill({ json: { version: 8, sources: {}, layers: [] } });
    else await route.abort('blockedbyclient');
  });
});

test('language persists before sign-in and changes retained UI state', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/shellter');
  await page
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('sv');
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  await expect(
    page.getByRole('combobox', { name: 'Språk', exact: true }),
  ).toHaveValue('sv');
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Språk', exact: true }),
  ).toHaveValue('sv');
  await page
    .getByRole('button', {
      name: 'Utforska demon med fiktiva uppgifter',
      exact: true,
    })
    .click();
  const card = page.getByRole('article', {
    name: 'Example balcony home',
    exact: true,
  });
  await card
    .getByRole('button', { name: 'Spara favorit', exact: true })
    .click();
  await expect(
    card.getByRole('button', { name: 'Ta bort min favorit', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('searchbox', { name: 'Sök på rubrik', exact: true })
    .fill('Example');
  const before = page.url();
  await page
    .getByRole('combobox', { name: 'Språk', exact: true })
    .selectOption('en');

  await expect(
    page.getByRole('searchbox', { name: 'Search by title', exact: true }),
  ).toHaveValue('Example');
  expect(page.url()).toBe(before);
  await expect(
    card.getByRole('button', { name: 'Remove my favorite', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('shellter.language')),
  ).toBe('en');
  expect(errors).toEqual([]);

  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Settings/ }).click();
  await page
    .getByRole('combobox', { name: 'Search location', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'Centralstationen', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Radius', exact: true }).click();
  await page.getByRole('option', { name: '2 km', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Maximum budget (SEK)' })
    .fill('3600000');
  await page
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('sv');
  await expect(
    page.getByRole('combobox', { name: 'Sökområde', exact: true }),
  ).toHaveValue('Centralstationen');
  await expect(
    page.getByRole('textbox', { name: 'Maxbudget (SEK)' }),
  ).toHaveValue('3 600 000');
  await page.getByRole('combobox', { name: 'Sökområde', exact: true }).click();
  await page
    .getByRole('option', { name: 'Göteborg (hela kommunen)', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Språk', exact: true })
    .selectOption('en');
  await expect(
    page.getByRole('combobox', { name: 'Search location', exact: true }),
  ).toHaveValue('Göteborg (whole city)');
  expect(errors).toEqual([]);
});

test('Swedish fits a narrow screen and leaving Shellter restores the document language', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() =>
    localStorage.setItem('shellter.language', 'sv'),
  );
  await page.goto('/shellter');
  await expect(
    page.getByRole('combobox', { name: 'Språk', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('button', {
      name: 'Utforska demon med fiktiva uppgifter',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Bostäder', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '.browser-test-results/language-swedish-narrow.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.getByRole('link', { name: 'Tillbaka till verkstaden' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('map markers and controls change language without replacing the map', async ({
  page,
}) => {
  await page.goto('/shellter');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const map = page.getByLabel('Listing map', { exact: true });
  const canvas = map.locator('canvas');
  await expect(canvas).toBeVisible();
  const originalCanvas = await canvas.elementHandle();
  const marker = page.getByRole('button', { name: /^2 homes nearby/ });
  await expect(marker).toBeVisible();
  const originalMarker = await marker.elementHandle();
  await page
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('sv');
  const translatedMap = page.getByLabel('Bostadskarta', { exact: true });
  await expect(
    translatedMap.locator('.maplibregl-ctrl-zoom-in'),
  ).toHaveAttribute('aria-label', 'Zooma in');
  await expect(translatedMap.locator('canvas')).toHaveAttribute(
    'aria-label',
    'Karta',
  );
  await expect(
    page.getByRole('button', { name: /^2 bostäder i närheten.*sparad av/ }),
  ).toBeVisible();
  expect(await originalCanvas?.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  expect(await originalMarker?.evaluate((element) => element.isConnected)).toBe(
    true,
  );
});

test('blocked preference writes keep the chosen language usable and explain persistence failure', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'shellter.language')
        throw new DOMException('Storage blocked', 'SecurityError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/shellter');
  await page
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('sv');
  await expect(
    page.getByText(
      'Ditt språkval kunde inte sparas. Det gäller tills du lämnar sidan.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Språk', exact: true }),
  ).toHaveValue('sv');
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Language', exact: true }),
  ).toHaveValue('en');
});

test('changing language preserves a panned camera even when a home remains selected', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop', 'Mouse panning regression');
  await page.goto('/shellter');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('button', { name: /^2 homes nearby/ }).click();
  const marker = page.getByRole('button', { name: /^Example balcony home:/ });
  await marker.click();
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  const canvas = page
    .getByLabel('Listing map', { exact: true })
    .locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Map canvas is missing');
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, {
    steps: 12,
  });
  await page.mouse.up();
  let previous = '';
  let stable = 0;
  await expect
    .poll(
      async () => {
        const current = await marker.locator('..').getAttribute('style');
        stable = current === previous ? stable + 1 : 0;
        previous = current ?? '';
        return stable;
      },
      { intervals: [100] },
    )
    .toBeGreaterThanOrEqual(3);
  const position = await marker.locator('..').getAttribute('style');
  await page
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('sv');
  const translated = page.getByRole('button', {
    name: /^Example balcony home:/,
  });
  await expect(translated).toHaveAttribute('aria-pressed', 'true');
  await expect(translated.locator('..')).toHaveAttribute(
    'style',
    position ?? '',
  );
});
