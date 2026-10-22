import { expect, type Page, test } from '@playwright/test';

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
  await page.route('https://images.example.invalid/map-home.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><path fill="#bfdae3" d="M0 0h800v600H0z"/><path fill="#709579" d="M0 400h800v200H0z"/><path fill="#eee1c9" d="M170 270h460v240H170z"/><path fill="#865b48" d="m130 280 270-180 270 180z"/><path fill="#507a83" d="M220 320h95v95h-95zm265 0h95v95h-95z"/><path fill="#a18060" d="M355 350h90v160h-90z"/></svg>',
    }),
  );
});

async function openMap(page: Page, count = 4) {
  await page.route(
    '**/src/features/house-scanner/mock/synthetic-household.ts*',
    async (route) => {
      const response = await route.fetch();
      // Use the real workspace with fictional homes, without changing the shared fixture.
      const fixture = `
      const clusterTemplate = SYNTHETIC_SNAPSHOT.listings[0];
      SYNTHETIC_SNAPSHOT.listings = Array.from({ length: ${count} }, (_, index) => ({
        ...clusterTemplate,
        id: index === 0 ? clusterTemplate.id : '10000000-0000-4000-8000-' + String(index).padStart(12, '0'),
        title: 'Cluster home ' + (index + 1),
        photo: {
          url: 'https://images.example.invalid/map-home.svg',
          attribution: 'Synthetic illustration',
          rightsBasis: 'Authored fixture',
          observedAt: '2026-10-12T12:00:00Z',
          expiresAt: '2099-10-12T12:00:00Z',
          displayAllowed: true,
          hotlinkAllowed: true,
        },
        coordinates: {
          ...clusterTemplate.coordinates,
          longitude: ${count === 4 ? '[11.97, 11.97, 11.9714, 12.01][index]' : '11.97 + (Math.floor(index / 5) % 20) * 0.0002'},
          latitude: ${count === 4 ? '57.71' : '57.71 + Math.floor(index / 100) * 0.0002'},
        },
      }));
      SYNTHETIC_SNAPSHOT.listings.push({
        ...clusterTemplate,
        id: '20000000-0000-4000-8000-000000000001',
        title: 'Cluster home without position',
        coordinates: null,
      });
    `;
      await route.fulfill({
        response,
        body: (await response.text()) + fixture,
      });
    },
  );
  await page.goto(`/shellter/listings${count === 4 ? '' : '?view=map'}`);
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  if (count === 4)
    await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(
    page.getByLabel('Listing map').locator('.maplibregl-marker').first(),
  ).toBeVisible();
}

async function openOptionsOnPhone(page: Page) {
  if (test.info().project.name === 'narrow')
    await page.getByRole('button', { name: 'Map options' }).click();
}

test('keyboard expansion keeps exact stacks, saved state and marker focus', async ({
  page,
}) => {
  await openMap(page);
  await openOptionsOnPhone(page);
  const nearby = page.getByRole('button', {
    name: /^3 homes nearby, 1 saved by household/,
  });
  await expect(nearby).toBeVisible();
  await expect(nearby).toHaveText('3');
  const target = await nearby.boundingBox();
  if (!target) throw new Error('Missing cluster touch target.');
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  await expect(
    page.getByRole('button', { name: 'Not located (1)', exact: true }),
  ).toBeVisible();
  await nearby.focus();
  await page.keyboard.press('Enter');
  const stack = page.getByRole('button', { name: /^2 homes at this point/ });
  await expect(stack).toBeFocused();
  await expect(nearby).toHaveCount(0);
  await expect(
    page.getByRole('article', { name: /^Selected home:/ }),
  ).toHaveCount(0);
  const originalButton = await stack.elementHandle();
  if (!originalButton) throw new Error('Missing stack marker.');
  await page.keyboard.press('Enter');
  const preview = page.getByRole('article', {
    name: 'Selected home: Cluster home 1',
    exact: true,
  });
  await expect(preview).toBeVisible();
  await expect(stack).toHaveAttribute('aria-pressed', 'true');
  expect(
    await originalButton.evaluate(
      (button) => button === document.activeElement,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Home 2', exact: true }).click();
  await expect(
    page.getByRole('article', {
      name: 'Selected home: Cluster home 2',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Home 1', exact: true }).click();
  await preview
    .getByRole('button', { name: 'Save favorite', exact: true })
    .click();
  await expect(stack).toHaveText('2');
  expect(await originalButton.evaluate((button) => button.isConnected)).toBe(
    true,
  );
  await stack.focus();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(stack).toBeFocused();
});

test('the synthetic demo exposes a nearby cluster', async ({ page }) => {
  await page.goto('/shellter/listings?view=map');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(
    page.getByRole('button', { name: /^2 homes nearby/ }),
  ).toBeVisible();
});

test('card layouts switch an open preview and preserve details, saves and selection', async ({
  page,
}) => {
  await openMap(page);
  await page.getByRole('button', { name: /^3 homes nearby/ }).click();
  const pin = page.getByRole('button', { name: /^2 homes at this point/ });
  await pin.click();
  const preview = page.getByRole('article', {
    name: 'Selected home: Cluster home 1',
    exact: true,
  });
  await openOptionsOnPhone(page);
  await expect(
    page.getByRole('button', { name: 'Classic', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  if (test.info().project.name === 'narrow')
    await page.getByRole('button', { name: 'Map options' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Map options', exact: true }),
  ).toHaveCount(0);
  await expect(preview).toBeVisible();
  await expect(
    preview.getByRole('img', { name: 'Cluster home 1', exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByText('Synthetic illustration', { exact: true }),
  ).toBeVisible();
  const image = preview.getByRole('button', {
    name: 'View Cluster home 1',
    exact: true,
  });
  const imageBox = await image.boundingBox();
  const cardBox = await preview.boundingBox();
  if (!imageBox || !cardBox) throw new Error('Missing photo card geometry.');
  expect(imageBox.width / cardBox.width).toBeGreaterThan(0.95);
  expect(imageBox.height / cardBox.height).toBeGreaterThan(0.7);
  expect(cardBox.x).toBeGreaterThanOrEqual(0);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: test.info().outputPath('photo-card.png') });
  await preview.getByRole('button', { name: 'Details', exact: true }).click();
  const details = page.getByRole('dialog', {
    name: 'Cluster home 1',
    exact: true,
  });
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await preview
    .getByRole('button', { name: 'Save favorite', exact: true })
    .click();
  await expect(
    preview.getByRole('button', { name: 'Remove my favorite', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await preview
    .getByRole('button', { name: 'Select home', exact: true })
    .click();
  await expect(
    preview.getByRole('button', { name: 'Selected', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await openOptionsOnPhone(page);
  await page.getByRole('button', { name: 'Classic', exact: true }).click();
  if (test.info().project.name === 'narrow')
    await page.getByRole('button', { name: 'Map options' }).click();
  await expect(preview).toBeVisible();
  await expect(
    preview.getByRole('button', { name: 'Selected', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await preview.getByRole('button', { name: 'Close selected home' }).click();
  await expect(preview).toHaveCount(0);
});

test('zooming merges and splits markers while preserving the selected home', async ({
  page,
}) => {
  await openMap(page);
  const nearby = page.getByRole('button', { name: /^3 homes nearby/ });
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    document.documentElement.dataset.markerAnimations = '0';
    Element.prototype.animate = function (...args) {
      const keyframes = args[0];
      if (
        this instanceof HTMLButtonElement &&
        this.parentElement?.classList.contains('maplibregl-marker') &&
        Array.isArray(keyframes) &&
        keyframes[0]?.transform !== keyframes.at(-1)?.transform
      ) {
        document.documentElement.dataset.markerAnimations = String(
          Number(document.documentElement.dataset.markerAnimations) + 1,
        );
      }
      return animate.apply(this, args);
    };
  });
  await nearby.click();
  const stack = page.getByRole('button', { name: /^2 homes at this point/ });
  await expect(stack).toBeVisible();
  expect(
    Number(await page.locator('html').getAttribute('data-marker-animations')),
  ).toBeGreaterThan(0);
  await stack.click();
  await page.getByRole('button', { name: 'Home 2', exact: true }).click();
  const preview = page.getByRole('article', {
    name: 'Selected home: Cluster home 2',
    exact: true,
  });
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await stack.focus();
  await expect(nearby).toBeFocused();
  await expect(nearby).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(stack).toBeFocused();
  await expect(stack).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).toBeVisible();
});

test('capture reviews each original home behind a cluster and excludes unlocated homes', async ({
  page,
}) => {
  await openMap(page);
  await expect(
    page.getByRole('button', { name: /^3 homes nearby/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await openOptionsOnPhone(page);
  await page
    .getByRole('button', { name: 'Review this area', exact: true })
    .click();
  const review = page.getByRole('dialog', {
    name: 'Review homes in this view',
  });
  await expect(review.getByRole('checkbox')).toHaveCount(4);
  for (let index = 1; index <= 4; index++) {
    await expect(
      review.getByRole('checkbox', {
        name: `Select Cluster home ${index}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(
    review.getByRole('checkbox', {
      name: 'Select Cluster home 1',
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    review.getByText('Cluster home without position', { exact: true }),
  ).toHaveCount(0);
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /^3 homes nearby/ }),
  ).toBeVisible();
});

test('a thousand dense homes retain their counts as clusters expand', async ({
  page,
}) => {
  test.setTimeout(60000);
  await openMap(page, 999);
  const markers = page
    .getByLabel('Listing map')
    .locator('.maplibregl-marker button');
  await expect.poll(() => markers.count()).toBeGreaterThan(0);
  const counts = await markers.evaluateAll((buttons) =>
    buttons.map((button) =>
      Number(button.textContent?.match(/^\d+/)?.[0] ?? 0),
    ),
  );
  expect(counts.reduce((sum, count) => sum + count, 0)).toBe(999);
  expect(counts.length).toBeLessThan(30);
  const initialCount = counts.length;
  const cluster = page
    .getByRole('button', { name: /^\d+ homes nearby/ })
    .first();
  await cluster.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => markers.count()).toBeGreaterThan(initialCount);
  expect(
    await markers.evaluateAll((buttons) =>
      buttons.reduce(
        (sum, button) =>
          sum + Number(button.textContent?.match(/^\d+/)?.[0] ?? 0),
        0,
      ),
    ),
  ).toBe(999);
  expect(
    await markers.evaluateAll((buttons) =>
      buttons.includes(document.activeElement as HTMLButtonElement),
    ),
  ).toBe(true);
  await expect(
    page.getByRole('article', { name: /^Selected home:/ }),
  ).toHaveCount(0);
  await openOptionsOnPhone(page);
  await expect(
    page.getByRole('button', { name: 'Not located (1)', exact: true }),
  ).toBeVisible();
});
