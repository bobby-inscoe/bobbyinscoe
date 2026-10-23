import { expect, test } from '@playwright/test';

// Run against a production preview: service workers are deliberately disabled in development.
test('Shellter installs separately from the portfolio and has a public-only offline fallback', async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(
    !process.env.HOUSE_SCANNER_BROWSER_URL,
    'Requires a production preview',
  );
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL ?? '').origin) await route.continue();
    else await route.abort();
  });
  await page.goto('/shellter/listings');
  await expect(
    page.getByRole('heading', { name: 'Shellter', exact: true }),
  ).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/shellter/manifest.webmanifest',
  );
  await expect(page).toHaveTitle('Shellter');
  const manifestResponse = await context.request.get(
    '/shellter/manifest.webmanifest',
  );
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    id: '/shellter/',
    name: 'Shellter',
    scope: '/shellter/',
    start_url: '/shellter/listings',
    display: 'standalone',
  });
  for (const icon of manifest.icons) {
    const response = await context.request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
  }
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(new URL(scope).pathname).toBe('/shellter/');
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page.evaluate(() =>
    fetch('/shellter/manifest.webmanifest').then((response) => response.json()),
  );
  await context.setOffline(true);
  await expect(page.getByText(/You’re offline/)).toBeVisible();
  await page.goto('/shellter/listings?offline-check=fictional');
  await expect(
    page.getByRole('heading', { name: 'You’re offline' }),
  ).toBeVisible();
  const cachedPaths = await page.evaluate(async () => {
    const keys = await caches.keys();
    const requests = await Promise.all(
      keys.map(async (key) => (await caches.open(key)).keys()),
    );
    return requests.flat().map((request) => new URL(request.url).pathname);
  });
  expect(cachedPaths).toEqual(['/shellter/offline.html']);
  await page.screenshot({
    path: `.browser-test-results/offline-${test.info().project.name}.png`,
  });
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Shellter', exact: true }),
  ).toBeVisible();
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.json',
  );
  await page
    .getByRole('button', { name: 'Open Shellter project details' })
    .first()
    .click();
  await page
    .getByRole('link', { name: 'Open Shellter', exact: true })
    .first()
    .click();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/shellter/manifest.webmanifest',
  );
});
